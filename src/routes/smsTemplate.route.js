import mongoose from "mongoose";
import SmsTemplate from "../models/smsTemplate.model.js";
import SmsTemplateAudit from "../models/smsTemplateAudit.model.js";
import SenderId from "../models/senderId.model.js";
import SchoolSmsConfig from "../models/schoolSmsConfig.model.js";
import verifySuperAdmin from "../middleware/verifySuperAdmin.js";
import verifyInternalService from "../middleware/verifyInternalService.js";
import {
  countPlaceholders,
  normalizeFields,
} from "../utils/dltTemplate.js";

// This portal manages SCHOOL templates only.
// INMATE stays isolated.
const MANAGED_DOMAIN = "SCHOOL";

// -----------------------------------------------------------------------------
// SENDABLE TEMPLATE FILTER
// -----------------------------------------------------------------------------

const sendableTemplateFilter = {
  domain: MANAGED_DOMAIN,
  status: "ACTIVE",
  deletedAt: null,
  dltTemplateId: { $nin: ["", null] },
  senderId: { $nin: ["", null] },
};

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

const activeSenders = () =>
  SenderId.find({
    domain: MANAGED_DOMAIN,
    status: "ACTIVE",
    deletedAt: null,
  })
    .sort({ header: 1 })
    .lean();

const sendableTemplates = () =>
  SmsTemplate.find(sendableTemplateFilter)
    .select("name senderId dltTemplateId")
    .sort({ name: 1 })
    .lean();

const countBySender = (templates) =>
  templates.reduce((acc, t) => {
    acc[t.senderId] = (acc[t.senderId] || 0) + 1;
    return acc;
  }, {});

// Normalize one Sender ID.
// Example:
// " agswsl " -> "AGSWSL"
const norm = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

// -----------------------------------------------------------------------------
// AUDIT
// -----------------------------------------------------------------------------

const writeAudit = async (
  action,
  tpl,
  before,
  after,
  user
) => {
  try {
    await SmsTemplateAudit.create({
      action,
      templateId: tpl._id,
      templateName: tpl.name,
      domain: tpl.domain,

      actor: {
        id: user?.id,
        username: user?.username,
        role: user?.role,
      },

      before,
      after,
    });
  } catch (e) {
    // Auditing must never block the operation.
    console.error(
      "SMS template audit write failed:",
      e.message
    );
  }
};

// -----------------------------------------------------------------------------
// SENDER VALIDATION
// -----------------------------------------------------------------------------
//
// A template may only be ACTIVE when its Sender ID:
//
// - exists
// - belongs to SCHOOL domain
// - is ACTIVE
// - is not deleted
//
// -----------------------------------------------------------------------------

const assertUsableSender = async (header) => {
  const h = norm(header);

  if (!h) {
    return {
      ok: false,
      error: "A Sender ID is required to activate a template",
    };
  }

  const sender = await SenderId.findOne({
    domain: MANAGED_DOMAIN,
    header: h,
    deletedAt: null,
  });

  if (!sender) {
    return {
      ok: false,
      error: `Sender ID "${h}" is not registered`,
    };
  }

  if (sender.status !== "ACTIVE") {
    return {
      ok: false,
      error: `Sender ID "${h}" is not active`,
    };
  }

  return {
    ok: true,
  };
};

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

export default async function smsTemplateRoutes(fastify) {
  // ===========================================================================
  // INTERNAL — LOCAL SCHOOL SERVERS PULL APPROVED TEMPLATES
  // ===========================================================================
  //
  // This endpoint is hard-locked to SCHOOL.
  //
  // SchoolSmsConfig now contains:
  //
  // assignedSenderId: "AGSWSL"
  //
  // NOT:
  //
  // assignedSenderIds: ["AGSWSL", "AGEMRS"]
  //
  // Behavior:
  //
  // 1. Config exists + assignedSenderId = "AGSWSL"
  //      -> only AGSWSL templates
  //
  // 2. Config exists + assignedSenderId = ""
  //      -> no templates
  //
  // 3. Config does not exist
  //      -> fallback to DEFAULT_SMS_SENDER_ID
  //
  // ===========================================================================

  fastify.get(
    "/internal/active",
    { preHandler: verifyInternalService },
    async (req, reply) => {
      try {
        const {
          externalId,
          schoolCode,
        } = req.query || {};

        const DEFAULT_HEADER = (
          process.env.DEFAULT_SMS_SENDER_ID ||
          "AGSWSL"
        )
          .trim()
          .toUpperCase();

        const filter = {
          domain: MANAGED_DOMAIN,
          status: "ACTIVE",
          deletedAt: null,
          dltTemplateId: {
            $nin: ["", null],
          },
          senderId: {
            $nin: ["", null],
          },
        };

        // ---------------------------------------------------------------------
        // SCHOOL SENDER SCOPING
        // ---------------------------------------------------------------------

        const meta = {
          assignedSenderId: "",
          source: "fallback",
        };

        if (externalId || schoolCode) {
          const cfg = externalId
            ? await SchoolSmsConfig.findOne({
                externalId,
              }).lean()
            : await SchoolSmsConfig.findOne({
                schoolCode,
              }).lean();

          if (cfg) {
            // Explicit school configuration exists.
            meta.source = "config";

            meta.assignedSenderId =
              cfg.assignedSenderId || "";

            // ---------------------------------------------------------------
            // Explicitly configured with no Sender ID.
            //
            // This means the school cannot send SMS.
            // ---------------------------------------------------------------

            if (!meta.assignedSenderId) {
              filter.senderId = {
                $in: [],
              };
            } else {
              // Only templates belonging to this Sender ID.
              filter.senderId =
                meta.assignedSenderId;
            }
          } else {
            // ---------------------------------------------------------------
            // No configuration exists.
            //
            // Grace fallback for older schools.
            // ---------------------------------------------------------------

            meta.assignedSenderId =
              DEFAULT_HEADER;

            meta.source = "fallback";

            filter.senderId =
              DEFAULT_HEADER;
          }
        }

        // ---------------------------------------------------------------------
        // LOAD TEMPLATES
        // ---------------------------------------------------------------------

        let rows = await SmsTemplate.find(filter)
          .sort({ name: 1 })
          .lean();

        // ---------------------------------------------------------------------
        // REMOVE TEMPLATES WHOSE SENDER IS NO LONGER ACTIVE
        // ---------------------------------------------------------------------
        //
        // This protects against a Sender ID being deactivated/deleted after
        // it was assigned to the school.
        //
        // ---------------------------------------------------------------------

        if (rows.length) {
          const headers = [
            ...new Set(
              rows.map((r) => r.senderId)
            ),
          ];

          const activeHeaders =
            new Set(
              (
                await SenderId.find({
                  domain: MANAGED_DOMAIN,
                  header: {
                    $in: headers,
                  },
                  status: "ACTIVE",
                  deletedAt: null,
                })
                  .select("header")
                  .lean()
              ).map((s) => s.header)
            );

          rows = rows.filter((r) =>
            activeHeaders.has(r.senderId)
          );
        }

        return reply.code(200).send({
          success: true,

          data: rows.map(shape),

          meta,
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message: "Failed to load templates",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — LIST TEMPLATES
  // ===========================================================================

  fastify.get(
    "/",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        const {
          search = "",
          status,
          page = 1,
          limit = 10,
        } = req.query || {};

        const filter = {
          domain: MANAGED_DOMAIN,
          deletedAt: null,
        };

        // Status filter
        if (
          status &&
          ["ACTIVE", "INACTIVE"].includes(status)
        ) {
          filter.status = status;
        }

        // Search
        if (search) {
          filter.$or = [
            {
              name: {
                $regex: search,
                $options: "i",
              },
            },
            {
              dltTemplateId: {
                $regex: search,
                $options: "i",
              },
            },
            {
              description: {
                $regex: search,
                $options: "i",
              },
            },
          ];
        }

        const pageNum = Math.max(
          1,
          parseInt(page, 10) || 1
        );

        const perPage = Math.min(
          100,
          Math.max(
            1,
            parseInt(limit, 10) || 10
          )
        );

        const [rows, total] =
          await Promise.all([
            SmsTemplate.find(filter)
              .sort({
                updatedAt: -1,
              })
              .skip(
                (pageNum - 1) * perPage
              )
              .limit(perPage)
              .lean(),

            SmsTemplate.countDocuments(
              filter
            ),
          ]);

        return reply.code(200).send({
          success: true,

          data: rows.map(shape),

          pagination: {
            total,
            page: pageNum,
            limit: perPage,
            totalPages:
              Math.ceil(
                total / perPage
              ),
          },
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message:
            "Failed to list templates",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — TEMPLATE DETAIL
  // ===========================================================================

  fastify.get(
    "/:id",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return reply.code(400).send({
            success: false,
            message: "Invalid template id",
          });
        }

        const t =
          await SmsTemplate.findOne({
            _id: req.params.id,
            domain: MANAGED_DOMAIN,
            deletedAt: null,
          });

        if (!t) {
          return reply.code(404).send({
            success: false,
            message: "Template not found",
          });
        }

        return reply.code(200).send({
          success: true,
          data: shape(t),
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message:
            "Failed to fetch template",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — CREATE TEMPLATE
  // ===========================================================================

  fastify.post(
    "/",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        const {
          name,
          description = "",
          domain = MANAGED_DOMAIN,
          dltTemplateId = "",
          senderId = "",
          approvedText,
          status = "INACTIVE",
          fields,
        } = req.body || {};

        // Domain validation
        if (domain !== MANAGED_DOMAIN) {
          return reply.code(400).send({
            success: false,
            message:
              "Only SCHOOL templates can be managed here",
          });
        }

        // Name validation
        if (!name || !name.trim()) {
          return reply.code(400).send({
            success: false,
            message:
              "Template name is required",
          });
        }

        // Approved text validation
        if (
          !approvedText ||
          !approvedText.trim()
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "Approved template text is required",
          });
        }

        // Placeholder validation
        if (
          countPlaceholders(
            approvedText
          ) < 1
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "Approved text must contain at least one {#...#} placeholder",
          });
        }

        // Active template requires DLT ID
        if (
          status === "ACTIVE" &&
          !String(dltTemplateId).trim()
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "A DLT Template ID is required to activate a template",
          });
        }

        // Active template requires valid Sender ID
        if (status === "ACTIVE") {
          const senderCheck =
            await assertUsableSender(
              senderId
            );

          if (!senderCheck.ok) {
            return reply.code(400).send({
              success: false,
              message:
                senderCheck.error,
            });
          }
        }

        // Normalize fields
        const spec = normalizeFields(
          approvedText,
          fields
        );

        if (!spec.ok) {
          return reply.code(400).send({
            success: false,
            message: spec.error,
          });
        }

        // Duplicate name check
        const dup =
          await SmsTemplate.findOne({
            domain: MANAGED_DOMAIN,
            name: name.trim(),
            deletedAt: null,
          });

        if (dup) {
          return reply.code(409).send({
            success: false,
            message:
              "A template with this name already exists",
          });
        }

        // Create template
        const doc =
          await SmsTemplate.create({
            name: name.trim(),

            description:
              String(description).trim(),

            domain: MANAGED_DOMAIN,

            dltTemplateId:
              String(
                dltTemplateId
              ).trim(),

            senderId:
              String(senderId)
                .trim()
                .toUpperCase(),

            approvedText:
              approvedText.trim(),

            placeholderCount:
              countPlaceholders(
                approvedText
              ),

            fields: spec.fields,

            status:
              status === "ACTIVE"
                ? "ACTIVE"
                : "INACTIVE",

            version: 1,

            createdBy: {
              id: req.user.id,
              username:
                req.user.username,
            },

            updatedBy: {
              id: req.user.id,
              username:
                req.user.username,
            },
          });

        await writeAudit(
          "CREATE",
          doc,
          null,
          shape(doc),
          req.user
        );

        return reply.code(201).send({
          success: true,
          data: shape(doc),
          message: "Template created",
        });
      } catch (error) {
        if (error.code === 11000) {
          return reply.code(409).send({
            success: false,
            message:
              "A template with this name already exists",
          });
        }

        return reply.code(500).send({
          success: false,
          message:
            "Failed to create template",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — UPDATE TEMPLATE
  // ===========================================================================

  fastify.put(
    "/:id",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return reply.code(400).send({
            success: false,
            message: "Invalid template id",
          });
        }

        const t =
          await SmsTemplate.findOne({
            _id: req.params.id,
            domain: MANAGED_DOMAIN,
            deletedAt: null,
          });

        if (!t) {
          return reply.code(404).send({
            success: false,
            message: "Template not found",
          });
        }

        const before = shape(t);

        const {
          name,
          description,
          dltTemplateId,
          senderId,
          approvedText,
          status,
          fields,
          domain,
        } = req.body || {};

        // Domain cannot be changed
        if (
          domain !== undefined &&
          domain !== t.domain
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "Template domain cannot be changed",
          });
        }

        // ---------------------------------------------------------------------
        // NAME
        // ---------------------------------------------------------------------

        if (name !== undefined) {
          if (!name.trim()) {
            return reply.code(400).send({
              success: false,
              message:
                "Template name cannot be empty",
            });
          }

          const dup =
            await SmsTemplate.findOne({
              _id: {
                $ne: t._id,
              },
              domain: t.domain,
              name: name.trim(),
              deletedAt: null,
            });

          if (dup) {
            return reply.code(409).send({
              success: false,
              message:
                "A template with this name already exists",
            });
          }

          t.name = name.trim();
        }

        // ---------------------------------------------------------------------
        // DESCRIPTION
        // ---------------------------------------------------------------------

        if (description !== undefined) {
          t.description =
            String(description).trim();
        }

        // ---------------------------------------------------------------------
        // APPROVED TEXT
        // ---------------------------------------------------------------------

        let structuralChange = false;

        const textChanged =
          approvedText !== undefined &&
          approvedText.trim() !==
            t.approvedText;

        if (textChanged) {
          if (!approvedText.trim()) {
            return reply.code(400).send({
              success: false,
              message:
                "Approved template text cannot be empty",
            });
          }

          if (
            countPlaceholders(
              approvedText
            ) < 1
          ) {
            return reply.code(400).send({
              success: false,
              message:
                "Approved text must contain at least one {#...#} placeholder",
            });
          }

          t.approvedText =
            approvedText.trim();

          t.placeholderCount =
            countPlaceholders(
              t.approvedText
            );

          structuralChange = true;
        }

        // ---------------------------------------------------------------------
        // FIELDS
        // ---------------------------------------------------------------------

        if (
          fields !== undefined ||
          textChanged
        ) {
          const spec =
            normalizeFields(
              t.approvedText,
              fields
            );

          if (!spec.ok) {
            return reply.code(400).send({
              success: false,
              message: spec.error,
            });
          }

          t.fields = spec.fields;
        }

        // ---------------------------------------------------------------------
        // DLT TEMPLATE ID
        // ---------------------------------------------------------------------

        if (
          dltTemplateId !== undefined &&
          String(dltTemplateId).trim() !==
            t.dltTemplateId
        ) {
          t.dltTemplateId =
            String(
              dltTemplateId
            ).trim();

          structuralChange = true;
        }

        // ---------------------------------------------------------------------
        // SENDER ID
        // ---------------------------------------------------------------------

        if (
          senderId !== undefined &&
          String(senderId)
            .trim()
            .toUpperCase() !==
            t.senderId
        ) {
          t.senderId =
            String(senderId)
              .trim()
              .toUpperCase();

          structuralChange = true;
        }

        // ---------------------------------------------------------------------
        // STATUS
        // ---------------------------------------------------------------------

        if (
          status !== undefined &&
          status !== t.status
        ) {
          if (
            ![
              "ACTIVE",
              "INACTIVE",
            ].includes(status)
          ) {
            return reply.code(400).send({
              success: false,
              message:
                "Invalid status",
            });
          }

          if (
            status === "ACTIVE" &&
            !t.dltTemplateId
          ) {
            return reply.code(400).send({
              success: false,
              message:
                "A DLT Template ID is required to activate a template",
            });
          }

          if (status === "ACTIVE") {
            const senderCheck =
              await assertUsableSender(
                t.senderId
              );

            if (!senderCheck.ok) {
              return reply.code(400).send({
                success: false,
                message:
                  senderCheck.error,
              });
            }
          }

          t.status = status;
        }

        // ---------------------------------------------------------------------
        // SAFETY
        // ---------------------------------------------------------------------
        //
        // An ACTIVE template cannot exist without a DLT ID or Sender ID.
        // ---------------------------------------------------------------------

        if (
          (!t.dltTemplateId ||
            !t.senderId) &&
          t.status === "ACTIVE"
        ) {
          t.status = "INACTIVE";
        }

        // Version bump for structural changes
        if (structuralChange) {
          t.version += 1;
        }

        t.updatedBy = {
          id: req.user.id,
          username:
            req.user.username,
        };

        await t.save();

        await writeAudit(
          "UPDATE",
          t,
          before,
          shape(t),
          req.user
        );

        return reply.code(200).send({
          success: true,
          data: shape(t),
          message: "Template updated",
        });
      } catch (error) {
        if (error.code === 11000) {
          return reply.code(409).send({
            success: false,
            message:
              "A template with this name already exists",
          });
        }

        return reply.code(500).send({
          success: false,
          message:
            "Failed to update template",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — ACTIVATE / DEACTIVATE
  // ===========================================================================

  fastify.patch(
    "/:id/status",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return reply.code(400).send({
            success: false,
            message: "Invalid template id",
          });
        }

        const { status } =
          req.body || {};

        if (
          ![
            "ACTIVE",
            "INACTIVE",
          ].includes(status)
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "status must be ACTIVE or INACTIVE",
          });
        }

        const t =
          await SmsTemplate.findOne({
            _id: req.params.id,
            domain: MANAGED_DOMAIN,
            deletedAt: null,
          });

        if (!t) {
          return reply.code(404).send({
            success: false,
            message: "Template not found",
          });
        }

        if (
          status === "ACTIVE" &&
          !t.dltTemplateId
        ) {
          return reply.code(400).send({
            success: false,
            message:
              "A DLT Template ID is required to activate a template",
          });
        }

        if (status === "ACTIVE") {
          const senderCheck =
            await assertUsableSender(
              t.senderId
            );

          if (!senderCheck.ok) {
            return reply.code(400).send({
              success: false,
              message:
                senderCheck.error,
            });
          }
        }

        const before = shape(t);

        t.status = status;

        t.updatedBy = {
          id: req.user.id,
          username:
            req.user.username,
        };

        await t.save();

        await writeAudit(
          status === "ACTIVE"
            ? "ACTIVATE"
            : "DEACTIVATE",
          t,
          before,
          shape(t),
          req.user
        );

        return reply.code(200).send({
          success: true,
          data: shape(t),
          message:
            `Template ${
              status === "ACTIVE"
                ? "activated"
                : "deactivated"
            }`,
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message:
            "Failed to change status",
          error: error.message,
        });
      }
    }
  );

  // ===========================================================================
  // SUPER ADMIN — SOFT DELETE
  // ===========================================================================

  fastify.delete(
    "/:id",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return reply.code(400).send({
            success: false,
            message: "Invalid template id",
          });
        }

        const t =
          await SmsTemplate.findOne({
            _id: req.params.id,
            domain: MANAGED_DOMAIN,
            deletedAt: null,
          });

        if (!t) {
          return reply.code(404).send({
            success: false,
            message: "Template not found",
          });
        }

        const before = shape(t);

        t.deletedAt = new Date();

        t.status = "INACTIVE";

        t.updatedBy = {
          id: req.user.id,
          username:
            req.user.username,
        };

        await t.save();

        await writeAudit(
          "DELETE",
          t,
          before,
          shape(t),
          req.user
        );

        return reply.code(200).send({
          success: true,
          message: "Template deleted",
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message:
            "Failed to delete template",
          error: error.message,
        });
      }
    }
  );
}

// -----------------------------------------------------------------------------
// RESPONSE SHAPE
// -----------------------------------------------------------------------------

const shape = (t) => ({
  id: t._id,
  name: t.name,
  description: t.description,
  domain: t.domain,
  dltTemplateId: t.dltTemplateId,
  senderId: t.senderId || "",
  approvedText: t.approvedText,
  placeholderCount: t.placeholderCount,
  fields: t.fields,
  status: t.status,
  version: t.version,
  createdBy: t.createdBy,
  updatedBy: t.updatedBy,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});