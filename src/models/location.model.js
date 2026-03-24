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

    baseUrl: {
      type: String,
      required: true
    },

    amount: {
      type: Number,
      default: 100
    }
  },
  { timestamps: true }
);

export const Location = mongoose.model("Location", locationSchema);