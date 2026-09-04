import axios from "axios";
import { Location } from "../models/location.model.js";

// Mirrors a location created from the Global panel down to the Local school
// server so it shows up in that server's "Add Admin" dropdown. No admin account
// is provisioned here — the Super Admin attaches admins afterwards from the
// Admin screen.
// process.env is read here (not at module load) for the same reason noted in
// verifyLocationAccess.js: this module can be evaluated before dotenv.config().
export async function provisionLocalAdmin(location) {
  try {
    const res = await axios.post(
      `${process.env.LOCAL_SCHOOL_SERVER_URL}/internal/provision-location`,
      {
        schoolName: location.name,
        locationName: location.location,
        baseUrl: location.baseUrl || process.env.COMMON_BASE_URL || "",
        schoolCode: location.schoolCode,
        global_location_id: location._id.toString(),
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

    return { status: "success" };
  } catch (error) {
    return { status: "failed", message: error.response?.data?.message || error.message };
  }
}
