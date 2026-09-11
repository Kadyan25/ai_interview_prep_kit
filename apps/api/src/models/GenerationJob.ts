import mongoose, { Schema, type Model } from "mongoose";
import type { JobStatus, JobStep, JobType } from "@prep/shared";

export type GenerationJobDoc = {
  _id: mongoose.Types.ObjectId;
  kitId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: JobType;
  category: string | null;
  status: JobStatus;
  steps: JobStep[];
  error: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

const generationJobSchema = new Schema<GenerationJobDoc>(
  {
    kitId: { type: Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["full", "regen_brief", "regen_category", "regen_schedule"],
      required: true,
    },
    category: { type: String, default: null },
    status: {
      type: String,
      enum: ["queued", "running", "done", "failed"],
      required: true,
      default: "queued",
    },
    steps: { type: Schema.Types.Mixed, default: () => [] },
    error: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

generationJobSchema.index({ kitId: 1, createdAt: -1 });

export const GenerationJob: Model<GenerationJobDoc> =
  (mongoose.models.GenerationJob as Model<GenerationJobDoc>) ??
  mongoose.model<GenerationJobDoc>("GenerationJob", generationJobSchema);
