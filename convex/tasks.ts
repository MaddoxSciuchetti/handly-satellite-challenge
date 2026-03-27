import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const getTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

export const getNodes = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("nodes")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .take(8192);
  },
});

export const getEdges = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("edges")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .take(8192);
  },
});

// Step 1: frontend calls this to get a short-lived upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Returns every task with its signed image URL and metadata
export const getAllTasks = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").order("desc").take(100);
    return await Promise.all(
      tasks.map(async (task) => ({
        taskId: task._id,
        status: task.status,
        imageUrl: await ctx.storage.getUrl(task.imageId),
        createdAt: task._creationTime,
      }))
    );
  },
});

// Returns all in_progress tasks with a signed image URL ready for processing
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

// DEV ONLY — simulates what the Python backend will do: seeds fake nodes/edges and marks done
export const devSimulateCompletion = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    // Generate a small random graph
    const nodeCount = 30;
    const nodeIds: Id<"nodes">[] = [];

    for (let i = 0; i < nodeCount; i++) {
      const id = await ctx.db.insert("nodes", {
        taskId: args.taskId,
        x: Math.random() * 800,
        y: Math.random() * 600,
      });
      nodeIds.push(id);
    }

    // Connect each node to its neighbour
    for (let i = 0; i < nodeIds.length - 1; i++) {
      await ctx.db.insert("edges", {
        taskId: args.taskId,
        fromNodeId: nodeIds[i],
        toNodeId: nodeIds[i + 1],
      });
    }

    await ctx.db.patch(args.taskId, { status: "done" });
  },
});

// Step 2: frontend calls this after the image is uploaded, passing back the storageId
export const createTask = mutation({
  args: {
    imageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const taskId = await ctx.db.insert("tasks", {
      imageId: args.imageId,
      status: "in_progress",
    });
    return taskId;
  },
});
