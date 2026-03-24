import { Location } from "../models/location.model.js";

export default async function locationRoutes(fastify) {
    // Get all locations
    fastify.get("/", async (request, reply) => {
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
   fastify.post("/", async (req, reply) => {
  try {
    const { externalId, schoolCode, name, location, baseUrl } = req.body;
    // Basic validation
    if (!externalId || !name || !location || !baseUrl) {
      return reply.code(400).send({
        status: false,
        message: "Missing required fields"
      });
    }

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

    return reply.code(201).send(newLocation);

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
    fastify.put("/:externalId", async (req, reply) => {
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
    fastify.delete("/:id", async (req, reply) => {
        await Location.findByIdAndDelete(req.params.id);
        reply.send({ message: "Location deleted successfully" });
    });

    // Delete location
    fastify.get("/:id", async (req, reply) => {
        const locationData = await Location.findById(req.params.id);
        reply.code(200).send({ status: true, data: locationData, message: "Location deleted successfully" });
    });
}
