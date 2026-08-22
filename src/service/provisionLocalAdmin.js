import axios from "axios";
import crypto from "node:crypto";
import { Location } from "../models/location.model.js";

function slugify(str) {
  return (str || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "school";
}

function generateUsername(name) {
  return `${slugify(name)}_${crypto.randomBytes(2).toString("hex")}`;
}

function generatePassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
}

// Auto-provisions a matching admin + location on the Local school server for
// a location created directly from the Global panel, so it shows up in that
// server's Add Admin dropdown immediately instead of requiring the school to
// separately onboard itself locally.
// process.env is read here (not at module load) for the same reason noted in
// verifyLocationAccess.js: this module can be evaluated before dotenv.config().
export async function provisionLocalAdmin(location) {
  const username = generateUsername(location.name);
  const fullname = location.name;
  const password = generatePassword();

  try {
    const res = await axios.post(
      `${process.env.LOCAL_SCHOOL_SERVER_URL}/internal/provision-location`,
      {
        schoolName: location.name,
        locationName: location.location,
        baseUrl: location.baseUrl,
        schoolCode: location.schoolCode,
        global_location_id: location._id.toString(),
        username,
        fullname,
        password,
      },
      {
        timeout: 8000,
        headers: { "x-internal-service-key": process.env.INTERNAL_SERVICE_KEY },
      }
    );

    const localLocationId = res.data?.data?.locationId;
    if (localLocationId) {
      // Keep externalId aligned with the local server's own record id, matching
      // the convention syncGlobalLocationService.js uses when a local server
      // pushes its own location up (so future edits from that admin's local
      // dashboard still match this Global record).
      await Location.findByIdAndUpdate(location._id, { externalId: localLocationId.toString() });
    }

    return { status: "success", username, password };
  } catch (error) {
    return { status: "failed", message: error.response?.data?.message || error.message };
  }
}
