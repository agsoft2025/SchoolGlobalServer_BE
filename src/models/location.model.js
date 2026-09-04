import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    //  Machine identity (from local server)
    externalId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // Human / tenant identity
    schoolCode: {
      type: String,
      // required: true,
      unique: true,
      index: true
    },

    // Metadata (NOT unique)
    name: {
      type: String,
      required: true,
      trim: true
    },

    location: {
      type: String,
      required: true,
      trim: true
    },

    // Optional: one common base URL is shared by all local servers today, so it
    // is not configured per location. Kept on the schema so a per-server URL can
    // be introduced later without a migration.
    baseUrl: {
      type: String,
      required: false,
      default: ""
    },

    amount: {
      type: Number,
      default: 100
    }
  },
  { timestamps: true }
);

export const Location = mongoose.model("Location", locationSchema);