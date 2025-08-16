import fs from 'fs';
import path from 'path';

export const loadCommands = () => {
    const commandsDir = path.resolve(__dirname, '../commands');
    console.log(`Loading commands from: ${commandsDir}`);
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    const commandHandler: { [key: string]: Function } = {};

    commandFiles.forEach(file => {
        const commandName = path.basename(file, path.extname(file));
        try {
            const command = require(path.join(commandsDir, file));

            if (command && typeof command.execute === 'function') {
                const mainKey = `!${commandName.toLowerCase()}`;
                if (commandHandler[mainKey]) {
                    console.warn(`Duplicate command name detected: ${mainKey}. Overwriting.`);
                }
                commandHandler[mainKey] = command.execute;

                if (Array.isArray(command.aliases)) {
                    command.aliases.forEach((alias: string) => {
                        const aliasKey = `!${alias.toLowerCase()}`;
                        if (commandHandler[aliasKey]) {
                            console.warn(`Duplicate alias detected: ${aliasKey}. Overwriting.`);
                        }
                        commandHandler[aliasKey] = command.execute;
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

    return commandHandler;
};