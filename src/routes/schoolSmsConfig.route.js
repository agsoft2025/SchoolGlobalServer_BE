import SchoolSmsConfig from "../models/schoolSmsConfig.model.js";
import SchoolSmsConfigAudit from "../models/schoolSmsConfigAudit.model.js";
import SmsTemplate from "../models/smsTemplate.model.js";
import SenderId from "../models/senderId.model.js";
import verifySuperAdmin from "../middleware/verifySuperAdmin.js";

const MANAGED_DOMAIN = "SCHOOL";

// A sendable SCHOOL template: ACTIVE, not deleted, has both a DLT id and a
// registered sender header.
const sendableTemplateFilter = {
  domain: MANAGED_DOMAIN,
  status: "ACTIVE",
  deletedAt: null,
  dltTemplateId: { $nin: ["", null] },
  senderId: { $nin: ["", null] },
};

const activeSenders = () =>
  SenderId.find({ domain: MANAGED_DOMAIN, status: "ACTIVE", deletedAt: null }).sort({ header: 1 }).lean();

const sendableTemplates = () =>
  SmsTemplate.find(sendableTemplateFilter).select("name senderId dltTemplateId").sort({ name: 1 }).lean();

const countBySender = (templates) =>
  templates.reduce((acc, t) => {
    acc[t.senderId] = (acc[t.senderId] || 0) + 1;
    return acc;
  }, {});

const norm = (arr) =>
  [...new Set((Array.isArray(arr) ? arr : []).map((h) => String(h || "").trim().toUpperCase()).filter(Boolean))];

const writeAudit = async (action, externalId, schoolName, before, after, user) => {
  try {
    await SchoolSmsConfigAudit.create({
      action,
      externalId,
      schoolName,
      actor: { id: user?.id, username: user?.username, role: user?.role },
      before: { assignedSenderIds: before },
      after: { assignedSenderIds: after },
    });
  } catch (e) {
    console.error("School SMS config audit write failed:", e.message);
  }
};

// The tenant key is a free-form string (the local StudentLocation._id, also the
// Global Location.externalId once synced). We never require it to exist in the
// Global Location collection — the GlobalServer_FE joins this with the school
// list it pulls from the local school server.
export default async function schoolSmsConfigRoutes(fastify) {
  // All config rows + the sender catalogue + per-sender template counts.
  fastify.get("/", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      const [configs, senders, templates] = await Promise.all([
        SchoolSmsConfig.find().lean(),
        activeSenders(),
        sendableTemplates(),
      ]);
      const templateCountBySender = countBySender(templates);

      return reply.code(200).send({
        success: true,
        data: configs.map((c) => ({
          externalId: String(c.externalId),
          schoolCode: c.schoolCode || "",
          name: c.name || "",
          location: c.location || "",
          assignedSenderIds: c.assignedSenderIds || [],
          templateCount: (c.assignedSenderIds || []).reduce((n, h) => n + (templateCountBySender[h] || 0), 0),
          updatedAt: c.updatedAt || null,
          updatedBy: c.updatedBy || null,
        })),
        senders: senders.map((s) => ({ header: s.header, description: s.description, status: s.status })),
        templateCountBySender,
      });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to list school SMS configs", error: error.message });
    }
  });

  // One school's assignment + a per-sender template preview for the dialog.
  fastify.get("/:externalId", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      const { externalId } = req.params;
      const [cfg, senders, templates] = await Promise.all([
        SchoolSmsConfig.findOne({ externalId }).lean(),
        activeSenders(),
        sendableTemplates(),
      ]);

      const byHeader = templates.reduce((acc, t) => {
        (acc[t.senderId] = acc[t.senderId] || []).push({ id: String(t._id), name: t.name, dltTemplateId: t.dltTemplateId });
        return acc;
      }, {});

      const assigned = cfg?.assignedSenderIds || [];
      // Surface every ACTIVE sender, plus any assigned header that is no longer
      // active (so the Super Admin can see and clear it).
      const headers = [...new Set([...senders.map((s) => s.header), ...assigned])];

      return reply.code(200).send({
        success: true,
        data: {
          externalId,
          schoolCode: cfg?.schoolCode || "",
          name: cfg?.name || "",
          location: cfg?.location || "",
          configured: !!cfg,
          assignedSenderIds: assigned,
          availableSenders: headers.map((h) => {
            const s = senders.find((x) => x.header === h);
            return {
              header: h,
              status: s ? s.status : "INACTIVE",
              registered: !!s,
              templateCount: (byHeader[h] || []).length,
              templates: byHeader[h] || [],
            };
          }),
          updatedAt: cfg?.updatedAt || null,
          updatedBy: cfg?.updatedBy || null,
        },
      });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to fetch school SMS config", error: error.message });
    }
  });

  // Replace a school's assigned Sender IDs. `name`/`location`/`schoolCode` are
  // optional display fields the FE forwards from its school list.
  fastify.put("/:externalId", { preHandler: verifySuperAdmin }, async (req, reply) => {
    try {
      const { externalId } = req.params;
      const { assignedSenderIds, name, location, schoolCode } = req.body || {};

      if (!externalId || !String(externalId).trim()) {
        return reply.code(400).send({ success: false, message: "externalId is required" });
      }
      if (!Array.isArray(assignedSenderIds)) {
        return reply.code(400).send({ success: false, message: "assignedSenderIds must be an array" });
      }

      const headers = norm(assignedSenderIds);

      // Every header must resolve to an ACTIVE, non-deleted SenderId.
      if (headers.length) {
        const ok = await SenderId.find({
          domain: MANAGED_DOMAIN,
          header: { $in: headers },
          status: "ACTIVE",
          deletedAt: null,
        })
          .select("header")
          .lean();
        const okSet = new Set(ok.map((s) => s.header));
        const bad = headers.filter((h) => !okSet.has(h));
        if (bad.length) {
          return reply
            .code(400)
            .send({ success: false, message: `Unknown or inactive Sender ID(s): ${bad.join(", ")}` });
        }
      }

      const existing = await SchoolSmsConfig.findOne({ externalId }).lean();
      const before = existing?.assignedSenderIds || [];

      const set = {
        externalId: String(externalId),
        assignedSenderIds: headers,
        updatedBy: { id: req.user.id, username: req.user.username },
      };
      if (name !== undefined) set.name = String(name).trim();
      if (location !== undefined) set.location = String(location).trim();
      if (schoolCode !== undefined) set.schoolCode = String(schoolCode).trim();

      const cfg = await SchoolSmsConfig.findOneAndUpdate(
        { externalId: String(externalId) },
        { $set: set, $unset: { allowedTemplateIds: "" } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      const action = headers.length === 0 ? "CLEAR" : before.length === 0 ? "ASSIGN" : "CHANGE";
      await writeAudit(action, String(externalId), cfg.name || name || "", before, headers, req.user);

      return reply.code(200).send({ success: true, data: cfg, message: "SMS configuration saved" });
    } catch (error) {
      return reply.code(500).send({ success: false, message: "Failed to save school SMS config", error: error.message });
    }
  });
}
