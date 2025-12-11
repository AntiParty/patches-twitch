// src/commands/ping.ts
import os from "os";
import fs from "fs/promises";
import { Channel } from "../db";

export const execute = async (ctx: any, channel: string, str: string, tags: Record<string, any>) => {
  const start = Date.now();

  // Uptime
  const uptimeSec = Math.floor(process.uptime());
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const uptime = `${h}h ${m}m ${s}s`;

  // Memory
  const mem = process.memoryUsage();
  const usedMB = (mem.rss / 1024 / 1024).toFixed(0);
  const totalMB = (os.totalmem() / 1024 / 1024).toFixed(0);
  const percent = Math.round((parseInt(usedMB) / parseInt(totalMB)) * 100);

  // System Details
  const platform = os.platform();
  let temp = "N/A";

  if (platform === 'linux') {
    try {
      const raw = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
      temp = `${(parseInt(raw, 10) / 1000).toFixed(1)}°C`;
    } catch { }
  }

  // DB Health
  let dbHealth = "OK";
  try {
    await Channel.findOne({ where: {}, attributes: ['id'] });
  } catch {
    dbHealth = "ERR";
  }

  // Latency
  let latency = "0ms";
  if (tags && tags['tmi-sent-ts']) {
    const msgTs = parseInt(tags['tmi-sent-ts']);
    latency = `${Date.now() - msgTs}ms`;
  }

  const parts = [
    `🤖 FinalsBot v1.9.4`,
    `⏳ ${uptime}`,
    `📶 ${latency}`,
    `💾 ${usedMB}/${totalMB}MB (${percent}%)`,
    `🎲 DB: ${dbHealth}`
  ];

  if (temp !== "N/A") parts.push(`🌡️ ${temp}`);

  await ctx.say(parts.join(" | "));
};

export const aliases = ["status", "info"];