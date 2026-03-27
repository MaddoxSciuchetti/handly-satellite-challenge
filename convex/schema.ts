import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One task per image analysis job
  tasks: defineTable({
    status: v.union(v.literal("in_progress"), v.literal("done")),
    // Convex file storage ID for the uploaded satellite image
    imageId: v.id("_storage"),
  }).index("by_status", ["status"]),

  // Graph nodes (pixel/geo coordinates extracted from the image)
  nodes: defineTable({
    taskId: v.id("tasks"),
    x: v.number(),
    y: v.number(),
  }).index("by_taskId", ["taskId"]),

  // Graph edges connecting two nodes
  edges: defineTable({
    taskId: v.id("tasks"),
    fromNodeId: v.id("nodes"),
    toNodeId: v.id("nodes"),
  })
    .index("by_taskId", ["taskId"])
    .index("by_fromNodeId", ["fromNodeId"])
    .index("by_toNodeId", ["toNodeId"]),
});
