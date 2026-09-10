import mongoose from "mongoose";
import SenderId from "../models/senderId.model.js";
import SenderIdAudit from "../models/senderIdAudit.model.js";
import SmsTemplate from "../models/smsTemplate.model.js";
import verifySuperAdmin from "../middleware/verifySuperAdmin.js";

// This portal manages SCHOOL sender headers only. INMATE stays isolated.
const MANAGED_DOMAIN = "SCHOOL";

const HEADER_RE = /^[A-Z0-9]{3,11}$/;

const shape = (s) => ({
  id: s._id,
  header: s.header,
  description: s.description,
  dltEntityId: s.dltEntityId,
  domain: s.domain,
  status: s.status,
  createdBy: s.createdBy,
  updatedBy: s.updatedBy,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const writeAudit = async (action, doc, before, after, user) => {
  try {
    await SenderIdAudit.create({
      action,
      senderIdRef: doc._id,
      header: doc.header,
      domain: doc.domain,
      actor: { id: user?.id, username: user?.username, role: user?.role },
      before,
      after,
    });
  } catch (e) {
    console.error("Sender ID audit write failed:", e.message);
  }
};

// ACTIVE, non-deleted SCHOOL templates still pinned to this header. Deactivating
// or deleting such a sender would strand those templates, so it is blocked.
const blockingTemplates = (header) =>
  SmsTemplate.find({
    domain: MANAGED_DOMAIN,
    status: "ACTIVE",
    deletedAt: null,
    senderId: header,
  })
    .select("name")
    .lean();

export default async function senderIdRoutes(fastify) {
  // List (search + status filter + pagination).
  fastify.get("/", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      const { search = "", status, page = 1, limit = 10 } = req.query || {};

      const filter = { domain: MANAGED_DOMAIN, deletedAt: null };
      if (status && ["ACTIVE", "INACTIVE"].includes(status)) filter.status = status;
      if (search) {
        filter.$or = [
          { header: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { dltEntityId: { $regex: search, $options: "i" } },
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

      const [rows, total] = await Promise.all([
        SenderId.find(filter)
          .sort({ header: 1 })
          .skip((pageNum - 1) * perPage)
          .limit(perPage)
          .lean(),
        SenderId.countDocuments(filter),
      ]);

      return reply.code(200).send({
        success: true,
        data: rows.map(shape),
        pagination: { total, page: pageNum, limit: perPage, totalPages: Math.ceil(total / perPage) },
      });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to list sender IDs", error: error.message });
    }
  });

  // Detail
  fastify.get("/:id", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return reply.code(400).send({ success: false, message: "Invalid sender ID" });
      }
      const s = await SenderId.findOne({ _id: req.params.id, domain: MANAGED_DOMAIN, deletedAt: null });
      if (!s) return reply.code(404).send({ success: false, message: "Sender ID not found" });
      return reply.code(200).send({ success: true, data: shape(s) });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to fetch sender ID", error: error.message });
    }
  });

  // Create
  fastify.post("/", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      const { header, description = "", dltEntityId = "", domain = MANAGED_DOMAIN, status = "ACTIVE" } = req.body || {};

      if (domain !== MANAGED_DOMAIN) {
        return reply.code(400).send({ success: false, message: "Only SCHOOL sender IDs can be managed here" });
      }
      const h = String(header || "").trim().toUpperCase();
      if (!HEADER_RE.test(h)) {
        return reply
          .code(400)
          .send({ success: false, message: "Sender header must be 3–11 upper-case letters/digits" });
      }

      const dup = await SenderId.findOne({ domain: MANAGED_DOMAIN, header: h, deletedAt: null });
      if (dup) return reply.code(409).send({ success: false, message: "A sender ID with this header already exists" });

      const doc = await SenderId.create({
        header: h,
        description: String(description).trim(),
        dltEntityId: String(dltEntityId).trim(),
        domain: MANAGED_DOMAIN,
        status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        createdBy: { id: req.user.id, username: req.user.username },
        updatedBy: { id: req.user.id, username: req.user.username },
      });

      await writeAudit("CREATE", doc, null, shape(doc), req.user);
      return reply.code(201).send({ success: true, data: shape(doc), message: "Sender ID created" });
    } catch (error) {
      if (error.code === 11000) {
        return reply.code(409).send({ success: false, message: "A sender ID with this header already exists" });
      }
      return reply.code(500).send({ success: false, message: "Failed to create sender ID", error: error.message });
    }
  });

  // Update
  fastify.put("/:id", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return reply.code(400).send({ success: false, message: "Invalid sender ID" });
      }
      const s = await SenderId.findOne({ _id: req.params.id, domain: MANAGED_DOMAIN, deletedAt: null });
      if (!s) return reply.code(404).send({ success: false, message: "Sender ID not found" });

      const before = shape(s);
      const { header, description, dltEntityId, status, domain } = req.body || {};

      if (domain !== undefined && domain !== s.domain) {
        return reply.code(400).send({ success: false, message: "Sender ID domain cannot be changed" });
      }

      if (header !== undefined) {
        const h = String(header).trim().toUpperCase();
        if (!HEADER_RE.test(h)) {
          return reply
            .code(400)
            .send({ success: false, message: "Sender header must be 3–11 upper-case letters/digits" });
        }
        if (h !== s.header) {
          const dup = await SenderId.findOne({
            _id: { $ne: s._id },
            domain: s.domain,
            header: h,
            deletedAt: null,
          });
          if (dup) return reply.code(409).send({ success: false, message: "A sender ID with this header already exists" });
          // Renaming a header that ACTIVE templates still point at would strand them.
          const blockers = await blockingTemplates(s.header);
          if (blockers.length) {
            return reply.code(409).send({
              success: false,
              message: `Cannot rename: ${blockers.length} active template(s) use "${s.header}"`,
              templates: blockers.map((t) => t.name),
            });
          }
          s.header = h;
        }
      }
      if (description !== undefined) s.description = String(description).trim();
      if (dltEntityId !== undefined) s.dltEntityId = String(dltEntityId).trim();

      if (status !== undefined && status !== s.status) {
        if (!["ACTIVE", "INACTIVE"].includes(status)) {
          return reply.code(400).send({ success: false, message: "Invalid status" });
        }
        if (status === "INACTIVE") {
          const blockers = await blockingTemplates(s.header);
          if (blockers.length) {
            return reply.code(409).send({
              success: false,
              message: `Cannot deactivate: ${blockers.length} active template(s) use "${s.header}"`,
              templates: blockers.map((t) => t.name),
            });
          }
        }
        s.status = status;
      }

      s.updatedBy = { id: req.user.id, username: req.user.username };
      await s.save();

      await writeAudit("UPDATE", s, before, shape(s), req.user);
      return reply.code(200).send({ success: true, data: shape(s), message: "Sender ID updated" });
    } catch (error) {
      if (error.code === 11000) {
        return reply.code(409).send({ success: false, message: "A sender ID with this header already exists" });
      }
      return reply.code(500).send({ success: false, message: "Failed to update sender ID", error: error.message });
    }
  });

  // Activate / deactivate
  fastify.patch("/:id/status", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return reply.code(400).send({ success: false, message: "Invalid sender ID" });
      }
      const { status } = req.body || {};
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return reply.code(400).send({ success: false, message: "status must be ACTIVE or INACTIVE" });
      }
      const s = await SenderId.findOne({ _id: req.params.id, domain: MANAGED_DOMAIN, deletedAt: null });
      if (!s) return reply.code(404).send({ success: false, message: "Sender ID not found" });

      if (status === "INACTIVE") {
        const blockers = await blockingTemplates(s.header);
        if (blockers.length) {
          return reply.code(409).send({
            success: false,
            message: `Cannot deactivate: ${blockers.length} active template(s) use "${s.header}"`,
            templates: blockers.map((t) => t.name),
          });
        }
      }

      const before = shape(s);
      s.status = status;
      s.updatedBy = { id: req.user.id, username: req.user.username };
      await s.save();

      await writeAudit(status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE", s, before, shape(s), req.user);
      return reply
        .code(200)
        .send({ success: true, data: shape(s), message: `Sender ID ${status === "ACTIVE" ? "activated" : "deactivated"}` });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to change status", error: error.message });
    }
  });

  // Soft delete
  fastify.delete("/:id", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return reply.code(400).send({ success: false, message: "Invalid sender ID" });
      }
      const s = await SenderId.findOne({ _id: req.params.id, domain: MANAGED_DOMAIN, deletedAt: null });
      if (!s) return reply.code(404).send({ success: false, message: "Sender ID not found" });

      const blockers = await blockingTemplates(s.header);
      if (blockers.length) {
        return reply.code(409).send({
          success: false,
          message: `Cannot delete: ${blockers.length} active template(s) use "${s.header}"`,
          templates: blockers.map((t) => t.name),
        });
      }

      const before = shape(s);
      s.deletedAt = new Date();
      s.status = "INACTIVE";
      s.updatedBy = { id: req.user.id, username: req.user.username };
      await s.save();

      await writeAudit("DELETE", s, before, shape(s), req.user);
      return reply.code(200).send({ success: true, message: "Sender ID deleted" });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to delete sender ID", error: error.message });
    }
  });
}
