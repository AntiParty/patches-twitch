import fs from "fs";
import path from "path";

export const loadCommands = () => {
  const commandsDir = path.resolve(__dirname, "../commands");
  console.log(`Loading commands from: ${commandsDir}`);
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
          ctx: any,
          _channel: string,
          message: string,
          tags: Record<string, any>,
          args: string[]
        ) => {
          // correct argument order for all commands
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
            if (seenKeys.has(aliasKey)) {
              duplicateKeys.push(aliasKey);
            } else {
              commandHandler[aliasKey] = wrappedExecute;
              seenKeys.add(aliasKey);
              //console.log(`Registered alias: ${aliasKey} for command: ${mainKey}`);
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
      console.error(`Error loading command "${file}":`, err);
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