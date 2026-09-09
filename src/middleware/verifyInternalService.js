// Shared-secret gate for trusted server-to-server calls (a local school server
// pulling the list of approved SMS templates). Mirrors the service-key branch of
// verifyLocationAccess.js and SchoolServer_BE/src/middleware/verifyInternalService.js.
// process.env is read inside the handler for the same reason noted there.
const verifyInternalService = async (request, reply) => {
  const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
  const provided = request.headers["x-internal-service-key"];

  if (!internalServiceKey || provided !== internalServiceKey) {
    return reply.code(403).send({ success: false, message: "Forbidden: trusted service access required" });
  }

  request.isInternalService = true;
};

export default verifyInternalService;
