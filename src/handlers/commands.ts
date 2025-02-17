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
                commandHandler[`!${commandName.toLowerCase()}`] = command.execute;

                if (command.aliases && Array.isArray(command.aliases)) {
                    command.aliases.forEach((alias: string) => {
                        commandHandler[`!${alias.toLowerCase()}`] = command.execute;
                    });
                }
            }
        } catch (err) {
            console.error(`Error loading command "${file}":`, err);
        }
    });

    return commandHandler;
};

