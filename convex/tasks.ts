import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Validators ────────────────────────────────────────────────────────────────

const nodeV = v.object({ x: v.number(), y: v.number() });
const edgeV = v.object({ from: v.number(), to: v.number() });

// ── Queries ───────────────────────────────────────────────────────────────────

export const getTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

export const getAllTasks = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").order("desc").take(100);
    return await Promise.all(
      tasks.map(async (task) => ({
        taskId: task._id,
        status: task.status,
        imageUrl: await ctx.storage.getUrl(task.imageId),
        nodeCount: task.nodes?.length ?? 0,
        edgeCount: task.edges?.length ?? 0,
        createdAt: task._creationTime,
      }))
    );
  },
});

// Python backend polls this to find images that need processing
export const getPendingTasks = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .take(50);
    return await Promise.all(
      tasks.map(async (task) => ({
        taskId: task._id,
        imageUrl: await ctx.storage.getUrl(task.imageId),
        createdAt: task._creationTime,
      }))
    );
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────────

// Step 1: frontend gets a signed upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Step 2: frontend creates the task after uploading the image
export const createTask = mutation({
  args: { imageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", {
      imageId: args.imageId,
      status: "in_progress",
    });
  },
});

// Python backend calls this when it finishes processing
export const saveGraph = mutation({
  args: {
    taskId: v.id("tasks"),
    nodes: v.array(nodeV),
    edges: v.array(edgeV),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      nodes: args.nodes,
      edges: args.edges,
      status: "done",
    });
  },
});

// DEV ONLY — simulates the Python backend writing results
export const devSimulateCompletion = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const count = 30;
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * 800,
      y: Math.random() * 600,
    }));
    const edges = Array.from({ length: count - 1 }, (_, i) => ({
      from: i,
      to: i + 1,
    }));
    await ctx.db.patch(args.taskId, { nodes, edges, status: "done" });
  },
});
