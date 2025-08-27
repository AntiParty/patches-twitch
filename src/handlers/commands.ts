import fs from 'fs';
import path from 'path';
import { editcmd } from '../commands/editcmd';
import logger from '../util/logger';

/**
 * Loads all command modules from the commands directory and returns a handler object.
 * Each command must export an 'execute' function and may have aliases.
 * @returns {Object} commandHandler - Mapping of command names/aliases to execute functions
 */
export function loadCommands() {
    const commandsDir = path.resolve(__dirname, '../commands');
    console.log(`Loading commands from: ${commandsDir}`);
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    const commandHandler: { [key: string]: Function } = {};
    const seenKeys = new Set<string>();
    const duplicateKeys: string[] = [];

    // Add editcmd and its aliases directly
    const editAliases = ['!editcmd', '!setcmd', '!commandedit'];
    for (const alias of editAliases) {
        commandHandler[alias] = async (client, channel, message, tags) => {
            const args = message.trim().split(' ').slice(1); // Remove command
            const user = tags['display-name'] || tags.username;
            const response = await editcmd(channel.replace('#', ''), user, args);
            client.say(channel, response);
        };
    }

        commandFiles.forEach(file => {
            const commandName = path.basename(file, path.extname(file));
            try {
                const command = require(path.join(commandsDir, file));
                if (command && typeof command.execute === 'function') {
                    const mainKey = `!${commandName.toLowerCase()}`;
                    if (seenKeys.has(mainKey)) {
                        duplicateKeys.push(mainKey);
                    } else {
                        logger.info(`[commandHandler] Loaded command: ${mainKey}`);
                        commandHandler[mainKey] = command.execute;
                        seenKeys.add(mainKey);
                    }
                    if (Array.isArray(command.aliases)) {
                        command.aliases.forEach((alias: string) => {
                            const aliasKey = `!${alias.toLowerCase()}`;
                            if (seenKeys.has(aliasKey)) {
                                duplicateKeys.push(aliasKey);
                            } else {
                                logger.info(`[commandHandler] Loaded alias: ${aliasKey} for command: ${mainKey}`);
                                commandHandler[aliasKey] = command.execute;
                                seenKeys.add(aliasKey);
                            }
                        });
                    } else if (command.aliases) {
                        console.warn(`Aliases for command "${commandName}" are not an array.`);
                    }
                } else {
                    console.warn(`Command "${file}" does not export an 'execute' function.`);
                }
            } catch (err) {
                console.error(`Error loading command "${file}":`, err);
            }
        });

    if (duplicateKeys.length > 0) {
        console.warn(`Duplicate command/alias keys detected: ${duplicateKeys.join(', ')}. Skipping all duplicates.`);
    }

    return commandHandler;
}