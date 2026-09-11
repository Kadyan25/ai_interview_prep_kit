import mongoose, { Schema, type Model } from "mongoose";
import type { ItemStateMap, KitBody, KitCounters, KitResearch, KitStatus } from "@prep/shared";

export type KitDoc = {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  status: KitStatus;
  input: { jd: string; companyUrl: string; days: number };
  contentHash: string;
  body: KitBody | null;
  itemState: ItemStateMap;
  counters: KitCounters;
  version: number;
  research: KitResearch;
  createdAt: Date;
  updatedAt: Date;
};

const kitSchema = new Schema<KitDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["generating", "ready", "partial", "failed"],
      required: true,
      default: "generating",
    },
    input: {
      jd: { type: String, required: true },
      companyUrl: { type: String, default: "" },
      days: { type: Number, required: true, min: 1, max: 60 },
    },
    contentHash: { type: String, required: true, index: true },
    // The body is stored as-is so it always matches the Appendix A contract and
    // can be written to a batch output without translation.
    body: { type: Schema.Types.Mixed, default: null },
    // Builder state keyed by item id ("q3") or section name ("company_brief").
    itemState: { type: Schema.Types.Mixed, default: () => ({}) },
    counters: {
      r: { type: Number, default: 0 },
      q: { type: Number, default: 0 },
      f: { type: Number, default: 0 },
    },
    version: { type: Number, default: 1 },
    research: {
      hiringPageUrl: { type: String, default: null },
      hiringProcess: { type: String, default: null },
      discussion: { type: Schema.Types.Mixed, default: () => [] },
      skipped: { type: Schema.Types.Mixed, default: () => [] },
    },
  },
  { timestamps: true, minimize: false },
);

kitSchema.index({ userId: 1, createdAt: -1 });
kitSchema.index({ userId: 1, contentHash: 1 });

export const Kit: Model<KitDoc> =
  (mongoose.models.Kit as Model<KitDoc>) ?? mongoose.model<KitDoc>("Kit", kitSchema);
