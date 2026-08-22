import crypto from "node:crypto";
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
    const { name, location, baseUrl } = req.body;
    // Basic validation
    if (!name || !location || !baseUrl) {
      return reply.code(400).send({
        status: false,
        message: "Missing required fields"
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

    // Only auto-provision when a human created this here (req.isInternalService
    // is only set for calls authenticated via the shared service key, i.e. a
    // local server syncing its own already-admin-owned location up).
    let adminProvisioning = null;
    if (!req.isInternalService) {
      adminProvisioning = await provisionLocalAdmin(newLocation);
    }

    return reply.code(201).send({ ...newLocation.toObject(), adminProvisioning });

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

    // 🔑 UPSERT: update if exists, create if not
    const updated = await Location.findOneAndUpdate(
      { externalId },               // identity
      {
        $set: updateData,
        $setOnInsert: {
          externalId // ensure stored on create
        }
      },
      {
        new: true,
        upsert: true // THIS is the key
      }
    );

    return reply.code(200).send({
      status: true,
      data: updated,
      message: "Location upserted successfully"
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
