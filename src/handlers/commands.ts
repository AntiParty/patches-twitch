import fs from "fs";
import path from "path";
import logger from "@/util/logger";
import { Channel } from "@/db";

const ROLE_HIERARCHY = ["basic user", "tester", "admin", "staff", "owner"];

export const loadCommands = () => {
    const commandsDir = path.resolve(__dirname, "../commands");
    logger.info(`Loading commands from: ${commandsDir}`);
    const commandFiles = fs
        .readdirSync(commandsDir)
        .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

    const commandHandler: { [key: string]: Function } = {};
    const seenKeys = new Set<string>();
    const duplicateKeys: string[] = [];

    commandFiles.forEach((file) => {
        const commandName = path.basename(file, path.extname(file));
        try {
            const command = require(path.join(commandsDir, file));

            if (command && typeof command.execute === "function") {
                const mainKey = `!${commandName.toLowerCase()}`;

                const wrappedExecute = async (
                    ctx: { say: (msg: string) => Promise<void>; user?: string;[key: string]: any },
                    _channel: string,
                    message: string,
                    tags: Record<string, any>,
                    args: string[]
                ) => {
                    // Permission Check Middleware
                    if (command.minRole) {
                        const senderName = ctx.user;
                        if (!senderName) return; // Should not happen if authenticated, but safety first

                        const channelRecord = await Channel.findOne({ where: { username: senderName } });
                        const userRole = channelRecord?.role?.toLowerCase() || "basic user";
                        
                        const minRoleIndex = ROLE_HIERARCHY.indexOf(command.minRole.toLowerCase());
                        const userRoleIndex = ROLE_HIERARCHY.indexOf(userRole);

                        // If the required role isn't in our list, fail safe (block) OR warn. 
                        // Assuming strict hierarchy.
                        if (minRoleIndex === -1) {
                            logger.error(`Command ${mainKey} has invalid minRole: ${command.minRole}`);
                            return; 
                        }

                        if (userRoleIndex < minRoleIndex) {
                            await ctx.say(`@${tags?.['display-name'] || senderName} You do not have permission to use this command (Required: ${command.minRole}).`);
                            return;
                        }
                    }

                    // execute command
                    return command.execute(ctx, _channel, message, tags, args);
                };

                if (seenKeys.has(mainKey)) {
                    duplicateKeys.push(mainKey);
                } else {
                    commandHandler[mainKey] = wrappedExecute;
                    seenKeys.add(mainKey);
                }

                if (Array.isArray(command.aliases)) {
                    command.aliases.forEach((alias: string) => {
                        const aliasKey = `!${alias.toLowerCase()}`;
                        // Skip if alias matches the main command name to avoid duplicates
                        if (aliasKey === mainKey) {
                            return;
                        }
                        if (seenKeys.has(aliasKey)) {
                            duplicateKeys.push(aliasKey);
                        } else {
                            commandHandler[aliasKey] = wrappedExecute;
                            seenKeys.add(aliasKey);
                        }
                    });
                } else if (command.aliases) {
                    console.warn(`Aliases for command "${commandName}" are not an array.`);
                }
            } else {
                console.warn(
                    `Command "${file}" does not export an 'execute' function.`
                );
            }
        } catch (err) {
            logger.error(`Error loading command "${file}":`, err);
        }
    });

    if (duplicateKeys.length > 0) {
        console.warn(
            `Duplicate command/alias keys detected: ${duplicateKeys.join(
                ", "
            )}. Skipping all duplicates.`
        );
    }

    return commandHandler;
};