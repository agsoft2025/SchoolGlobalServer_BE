import crypto from "node:crypto";
import mongoose from "mongoose";
import { Location } from "../models/location.model.js";
import verifyLocationAccess from "../middleware/verifyLocationAccess.js";
import { provisionLocalAdmin } from "../service/provisionLocalAdmin.js";

export default async function locationRoutes(fastify) {
    // Get all locations
    fastify.get("/", { preHandler: verifyLocationAccess }, async (request, reply) => {
        try {
            const {
                search = "",       // for name or location search
                page = 1,
                limit = 10,
                sort_by = "createdAt",
                sort_order = "desc",
                baseUrl,           // optional filter
                location           // optional filter
            } = request.query;

            // 🧠 Build dynamic filter
            const filter = {};

            if (search) {
                filter.$or = [
                    { name: { $regex: search, $options: "i" } },
                    { location: { $regex: search, $options: "i" } },
                    { baseUrl: { $regex: search, $options: "i" } }
                ];
            }

            if (baseUrl) filter.baseUrl = baseUrl;
            if (location) filter.location = location;

            // ⚙️ Sorting
            const sortOptions = { [sort_by]: sort_order === "asc" ? 1 : -1 };

            // 🔢 Pagination
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const total = await Location.countDocuments(filter);
            const locations = await Location.find(filter)
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit));

            return reply.code(200).send({
                status: true,
                message: "Locations fetched successfully",
                data: locations,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                status: false,
                message: "Failed to fetch locations",
                error: error.message
            });
        }
    });

    // Add location
   fastify.post("/", { preHandler: verifyLocationAccess }, async (req, reply) => {
  try {
    const { name, location } = req.body;
    // Base URL is no longer configured per location (one common URL is shared by
    // all local servers); fall back to the shared value when absent.
    const baseUrl = req.body.baseUrl || process.env.COMMON_BASE_URL || "";
    // Basic validation
    if (!name || !location) {
      return reply.code(400).send({
        status: false,
        message: "name and location are required"
      });
    }

    // A local server pushing its own location up always sends its own record id
    // as externalId (see syncGlobalLocationService.js), which doubles as the
    // idempotency key below. A Super Admin creating a location directly here has
    // no such id to give, so one is generated — it gets replaced with the real
    // local record id once auto-provisioning (below) finishes.
    const externalId = req.body.externalId || crypto.randomUUID();
    const schoolCode = req.body.schoolCode || `SCH-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    // Idempotency check (CRITICAL)
    const existing = await Location.findOne({ externalId });
    if (existing) {
      // Same local server retrying → return existing
      return reply.code(200).send(existing);
    }

    // Create new global location
    const newLocation = await Location.create({
      externalId,
      schoolCode,
      name: name.trim(),
      location: location.trim(),
      baseUrl
    });

    // Mirror the location down to the local server only when a human created
    // this here (req.isInternalService is only set for calls authenticated via
    // the shared service key, i.e. a local server syncing its own location up).
    let locationSync = null;
    if (!req.isInternalService) {
      locationSync = await provisionLocalAdmin(newLocation);
    }

    return reply.code(201).send({ ...newLocation.toObject(), locationSync });

  } catch (error) {
    // Handle duplicate schoolCode explicitly
    if (error.code === 11000) {
      return reply.code(409).send({
        status: false,
        message: "School code already exists"
      });
    }

    return reply.code(500).send({
      status: false,
      message: error.message
    });
  }
});

    // Update location
    fastify.put("/:externalId", { preHandler: verifyLocationAccess }, async (req, reply) => {
  try {
    const { externalId } = req.params;
    const { name, location, baseUrl, amount, schoolCode } = req.body;

    if (!externalId) {
      return reply.code(400).send({
        status: false,
        message: "externalId is required"
      });
    }

    if (!name && !location && !baseUrl && amount === undefined && !schoolCode) {
      return reply.code(400).send({
        status: false,
        message: "Provide at least one field to update or create"
      });
    }

    // Build update object
    const updateData = {
      ...(name && { name: name.trim() }),
      ...(location && { location: location.trim() }),
      ...(baseUrl && { baseUrl: baseUrl.trim() }),
      ...(schoolCode && { schoolCode: schoolCode.trim() }),
      ...(amount !== undefined && { amount })
    };

    // Resolve identity. The Global panel addresses a location by its Mongo _id;
    // the local-server sync-up path (req.isInternalService) addresses it by
    // externalId (its own record id) and relies on create-if-missing. Matching
    // only on externalId here meant a Global-panel edit of an already-synced
    // location (externalId = local id, not _id) matched nothing and upserted a
    // duplicate junk row.
    const identity = mongoose.isValidObjectId(externalId)
      ? { $or: [{ _id: externalId }, { externalId }] }
      : { externalId };

    let updated = await Location.findOneAndUpdate(
      identity,
      { $set: updateData },
      { new: true }
    );

    // Only the trusted local-server path is allowed to create a location it
    // can't find; a Super Admin editing from the panel should get a clear 404.
    if (!updated) {
      if (!req.isInternalService) {
        return reply.code(404).send({ status: false, message: "Location not found" });
      }
      updated = await Location.findOneAndUpdate(
        { externalId },
        { $set: updateData, $setOnInsert: { externalId } },
        { new: true, upsert: true }
      );
    }

    // Re-mirror the location down to the local server on every human edit. This
    // is idempotent on the local side (upsert keyed by global_location_id) and
    // backfills locations whose original create-time sync failed, so they show
    // up in the local server's Add Admin dropdown. Skipped for internal
    // service calls (a local server pushing its own change up).
    let locationSync = null;
    if (!req.isInternalService) {
      locationSync = await provisionLocalAdmin(updated);
    }

    return reply.code(200).send({
      status: true,
      data: updated,
      locationSync,
      message: "Location updated successfully"
    });

  } catch (error) {
    if (error.code === 11000) {
      return reply.code(409).send({
        status: false,
        message: "Duplicate schoolCode"
      });
    }

    return reply.code(500).send({
      status: false,
      message: error.message
    });
  }
});
    // fastify.put("/:id", async (req, reply) => {
    //     try {
    //         console.log("<><>working",req.body)
    //     const existingLocation = await Location.findOne({
    //         _id: { $ne: req.params.id },
    //         name: { $regex: req.body.name, $options: "i" },
    //         location: { $regex: req.body.location, $options: "i" },
    //     });
    //     if(existingLocation){
    //         return reply.code(400).send({status:false,message:`Already existing school name ${req.body.name} with the same location ${req.body.location}`})
    //     }
    //     const updated = await Location.findByIdAndUpdate(req.params.id, req.body, {
    //         new: true,
    //     });
    //     reply.send({status:true,data:updated,message:"updated successfully"});
    //     } catch (error) {
    //         console.log("<><>error",error)
    //     }
    // });

    // Delete location
    fastify.delete("/:id", { preHandler: verifyLocationAccess }, async (req, reply) => {
        await Location.findByIdAndDelete(req.params.id);
        reply.send({ message: "Location deleted successfully" });
    });

    // Get single location
    fastify.get("/:id", { preHandler: verifyLocationAccess }, async (req, reply) => {
        const locationData = await Location.findById(req.params.id);
        reply.code(200).send({ status: true, data: locationData, message: "Location deleted successfully" });
    });
}
