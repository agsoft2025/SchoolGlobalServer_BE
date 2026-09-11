import SchoolSmsConfig from "../models/schoolSmsConfig.model.js";
import SchoolSmsConfigAudit from "../models/schoolSmsConfigAudit.model.js";
import SmsTemplate from "../models/smsTemplate.model.js";
import SenderId from "../models/senderId.model.js";
import verifySuperAdmin from "../middleware/verifySuperAdmin.js";

const MANAGED_DOMAIN = "SCHOOL";

// A sendable SCHOOL template:
// - ACTIVE
// - not deleted
// - has a DLT template ID
// - has a registered sender header
const sendableTemplateFilter = {
  domain: MANAGED_DOMAIN,
  status: "ACTIVE",
  deletedAt: null,
  dltTemplateId: { $nin: ["", null] },
  senderId: { $nin: ["", null] },
};

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
// Example: " agswsl " -> "AGSWSL"
const norm = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const writeAudit = async (
  action,
  externalId,
  schoolName,
  before,
  after,
  user
) => {
  try {
    await SchoolSmsConfigAudit.create({
      action,
      externalId,
      schoolName,

      actor: {
        id: user?.id,
        username: user?.username,
        role: user?.role,
      },

      before: {
        assignedSenderId: before,
      },

      after: {
        assignedSenderId: after,
      },
    });
  } catch (e) {
    console.error(
      "School SMS config audit write failed:",
      e.message
    );
  }
};

// The tenant key is a free-form string.
// It corresponds to the local StudentLocation._id and,
// after sync, Global Location.externalId.
//
// We do not require it to exist in the Global Location collection.
// The GlobalServer_FE joins this with the school list it receives
// from the local school server.
export default async function schoolSmsConfigRoutes(fastify) {
  /**
   * GET /
   *
   * Returns:
   * - all school SMS configurations
   * - active Sender IDs
   * - template counts per Sender ID
   */
  fastify.get(
    "/",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        const [configs, senders, templates] = await Promise.all([
          SchoolSmsConfig.find().lean(),
          activeSenders(),
          sendableTemplates(),
        ]);

        const templateCountBySender =
          countBySender(templates);

        return reply.code(200).send({
          success: true,

          data: configs.map((c) => ({
            externalId: String(c.externalId),

            schoolCode: c.schoolCode || "",

            name: c.name || "",

            location: c.location || "",

            // Single Sender ID
            assignedSenderId: c.assignedSenderId || "",

            // Number of templates belonging to the assigned Sender ID
            templateCount: c.assignedSenderId
              ? templateCountBySender[c.assignedSenderId] || 0
              : 0,

            updatedAt: c.updatedAt || null,

            updatedBy: c.updatedBy || null,
          })),

          senders: senders.map((s) => ({
            header: s.header,
            description: s.description,
            status: s.status,
          })),

          templateCountBySender,
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message: "Failed to list school SMS configs",
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /:externalId
   *
   * Returns one school's configuration and
   * available Sender IDs with their templates.
   */
  fastify.get(
    "/:externalId",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        const { externalId } = req.params;

        const [cfg, senders, templates] =
          await Promise.all([
            SchoolSmsConfig.findOne({ externalId }).lean(),
            activeSenders(),
            sendableTemplates(),
          ]);

        // Group templates by Sender ID header
        const byHeader = templates.reduce((acc, t) => {
          if (!acc[t.senderId]) {
            acc[t.senderId] = [];
          }

          acc[t.senderId].push({
            id: String(t._id),
            name: t.name,
            dltTemplateId: t.dltTemplateId,
          });

          return acc;
        }, {});

        // Single assigned Sender ID
        const assigned = cfg?.assignedSenderId || "";

        /**
         * Show:
         * - every ACTIVE Sender ID
         * - assigned Sender ID even if it is no longer active
         *
         * This allows the Super Admin to see an old/inactive
         * assignment and clear/change it.
         */
        const headers = [
          ...new Set([
            ...senders.map((s) => s.header),
            ...(assigned ? [assigned] : []),
          ]),
        ];

        return reply.code(200).send({
          success: true,

          data: {
            externalId,

            schoolCode: cfg?.schoolCode || "",

            name: cfg?.name || "",

            location: cfg?.location || "",

            configured: !!cfg,

            // Single Sender ID
            assignedSenderId: assigned,

            availableSenders: headers.map((h) => {
              const s = senders.find(
                (x) => x.header === h
              );

              return {
                header: h,

                status: s
                  ? s.status
                  : "INACTIVE",

                registered: !!s,

                templateCount:
                  (byHeader[h] || []).length,

                templates:
                  byHeader[h] || [],
              };
            }),

            updatedAt: cfg?.updatedAt || null,

            updatedBy: cfg?.updatedBy || null,
          },
        });
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message:
            "Failed to fetch school SMS config",
          error: error.message,
        });
      }
    }
  );

  /**
   * PUT /:externalId
   *
   * Assign/change/clear ONE Sender ID for a school.
   *
   * Request:
   *
   * {
   *   "assignedSenderId": "AGSWSL",
   *   "name": "ABC School",
   *   "location": "Coimbatore",
   *   "schoolCode": "ABC001"
   * }
   *
   * To clear:
   *
   * {
   *   "assignedSenderId": ""
   * }
   */
  fastify.put(
    "/:externalId",
    { preHandler: verifySuperAdmin },
    async (req, reply) => {
      try {
        const { externalId } = req.params;

        const {
          assignedSenderId,
          name,
          location,
          schoolCode,
        } = req.body || {};

        // Validate externalId
        if (
          !externalId ||
          !String(externalId).trim()
        ) {
          return reply.code(400).send({
            success: false,
            message: "externalId is required",
          });
        }

        // Normalize single Sender ID
        const header = norm(assignedSenderId);

        /**
         * If a Sender ID was supplied, make sure it:
         *
         * - belongs to SCHOOL domain
         * - is ACTIVE
         * - is not deleted
         */
        if (header) {
          const sender = await SenderId.findOne({
            domain: MANAGED_DOMAIN,
            header,
            status: "ACTIVE",
            deletedAt: null,
          })
            .select("header")
            .lean();

          if (!sender) {
            return reply.code(400).send({
              success: false,
              message:
                `Unknown or inactive Sender ID: ${header}`,
            });
          }
        }

        // Existing configuration
        const existing =
          await SchoolSmsConfig.findOne({
            externalId,
          }).lean();

        // Previous Sender ID
        const before =
          existing?.assignedSenderId || "";

        /**
         * Determine action:
         *
         * No previous + no new = CLEAR
         * No previous + new     = ASSIGN
         * Previous + no new     = CLEAR
         * Previous + new        = CHANGE
         */
        let action;

        if (!header) {
          action = "CLEAR";
        } else if (!before) {
          action = "ASSIGN";
        } else {
          action = "CHANGE";
        }

        // Data to save
        const set = {
          externalId: String(externalId),

          assignedSenderId: header,

          updatedBy: {
            id: req.user.id,
            username: req.user.username,
          },
        };

        // Optional display fields
        if (name !== undefined) {
          set.name = String(name).trim();
        }

        if (location !== undefined) {
          set.location = String(location).trim();
        }

        if (schoolCode !== undefined) {
          set.schoolCode = String(schoolCode).trim();
        }

        // Create/update configuration
        const cfg =
          await SchoolSmsConfig.findOneAndUpdate(
            {
              externalId: String(externalId),
            },
            {
              $set: set,

              // Remove old field if it existed from the
              // previous implementation.
              $unset: {
                allowedTemplateIds: "",
                assignedSenderIds: "",
              },
            },
            {
              new: true,
              upsert: true,
              setDefaultsOnInsert: true,
            }
          ).lean();

        // Write audit
        await writeAudit(
          action,
          String(externalId),
          cfg.name || name || "",
          before,
          header,
          req.user
        );

        return reply.code(200).send({
          success: true,
          data: cfg,
          message: "SMS configuration saved",
        });
      } catch (error) {
        console.error(
          "Failed to save school SMS config:",
          error
        );

        return reply.code(500).send({
          success: false,
          message:
            "Failed to save school SMS config",
          error: error.message,
        });
      }
    }
  );
}