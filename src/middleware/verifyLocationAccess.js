import usermodel from "../models/auth.model.js";
import jwt from "jsonwebtoken";

// Location records represent tenants (school orgs) and hold baseUrl/subscription
// data, so every route here must be locked down to either:
//   1. the local server pushing its own sync (trusted via a shared service key), or
//   2. a logged-in Super Admin (JWT).
// process.env is read inside the handler (not captured at module load) since this
// module can be evaluated before dotenv.config() runs in server.js's ESM import graph.
const verifyLocationAccess = async (request, reply) => {
  const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
  const serviceKey = request.headers["x-internal-service-key"];
  if (internalServiceKey && serviceKey === internalServiceKey) {
    request.isInternalService = true;
    return;
  }

  const authHeader = request.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return reply.code(401).send({ message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "SUPER ADMIN") {
      return reply.code(403).send({ message: "Super Admin access required" });
    }

    const userExist = await usermodel.findById(decoded.id);
    if (!userExist) {
      return reply.code(403).send({ success: false, message: "Invalid credentials (user deleted)" });
    }

    request.user = { id: decoded.id, username: decoded.username, role: decoded.role };
  } catch (error) {
    return reply.code(403).send({ message: "Invalid token" });
  }
};

export default verifyLocationAccess;
