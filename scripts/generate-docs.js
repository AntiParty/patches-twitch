const fs = require('fs');
const path = require('path');

// Configuration - adjust to match your project structure
const COMMANDS_DIR = './src/commands';
const OUTPUT_FILE = './COMMANDS.md';

// Parse command files to extract metadata
function parseCommand(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath, path.extname(filePath));
  
  // Extract aliases array: export const aliases = ["r", "rank"]
  let aliases = [];
  const aliasesMatch = content.match(/export\s+const\s+aliases\s*=\s*\[(.*?)\]/s);
  if (aliasesMatch) {
    aliases = aliasesMatch[1]
      .split(',')
      .map(a => a.trim().replace(/['"]/g, ''))
      .filter(a => a);
  }
  
  // Extract JSDoc comment if present
  const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  let description = '';
  let usage = '';
  let permission = 'everyone';
  
  if (jsdocMatch) {
    const jsdoc = jsdocMatch[1];
    const descMatch = jsdoc.match(/@description\s+(.+)/);
    const usageMatch = jsdoc.match(/@usage\s+(.+)/);
    const permMatch = jsdoc.match(/@permission\s+(.+)/);
    
    description = descMatch ? descMatch[1].trim() : '';
    usage = usageMatch ? usageMatch[1].trim() : '';
    permission = permMatch ? permMatch[1].trim() : 'everyone';
  }
  
  // Fallback: try to infer description from code comments
  if (!description) {
    const commentMatch = content.match(/\/\/\s*(.+)/);
    description = commentMatch ? commentMatch[1].trim() : 'No description available';
  }
  
  return {
    name: fileName,
    description,
    aliases,
    usage: usage || `${fileName}`,
    permission,
    file: path.basename(filePath)
  };
}

// Get all command files
function getAllCommands(dir) {
  const commands = [];
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      commands.push(...getAllCommands(filePath));
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      try {
        commands.push(parseCommand(filePath));
      } catch (err) {
        console.warn(`Failed to parse ${file}:`, err.message);
      }
    }
  }
  
  return commands;
}

// Generate markdown documentation
function generateMarkdown(commands) {
  const timestamp = new Date().toISOString().split('T')[0];
  
  let markdown = `# Bot Commands\n\n`;
  markdown += `> Auto-generated on ${timestamp}\n\n`;
  markdown += `Total commands: **${commands.length}**\n\n`;
  
  // Group by permission level
  const grouped = commands.reduce((acc, cmd) => {
    const perm = cmd.permission || 'everyone';
    if (!acc[perm]) acc[perm] = [];
    acc[perm].push(cmd);
    return acc;
  }, {});
  
  // Sort groups: everyone, subscriber, vip, moderator, broadcaster
  const order = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'];
  const sortedGroups = Object.keys(grouped).sort((a, b) => {
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
  
  for (const perm of sortedGroups) {
    markdown += `## ${perm.charAt(0).toUpperCase() + perm.slice(1)} Commands\n\n`;
    
    // Sort commands alphabetically within group
    grouped[perm].sort((a, b) => a.name.localeCompare(b.name));
    
    for (const cmd of grouped[perm]) {
      markdown += `### !${cmd.name}\n`;
      markdown += `${cmd.description}\n\n`;
      
      if (cmd.usage && cmd.usage !== cmd.name) {
        markdown += `**Usage:** \`!${cmd.usage}\`\n\n`;
      }
      
      if (cmd.aliases.length > 0) {
        markdown += `**Aliases:** ${cmd.aliases.map(a => `\`!${a}\``).join(', ')}\n\n`;
      }
      
      markdown += `---\n\n`;
    }
  }
  
  return markdown;
}

// Main execution
try {
  console.log('Scanning for commands...');
  const commands = getAllCommands(COMMANDS_DIR);
  console.log(`Found ${commands.length} commands`);
  
  console.log('Generating documentation...');
  const markdown = generateMarkdown(commands);
  
  fs.writeFileSync(OUTPUT_FILE, markdown);
  console.log(`✓ Documentation written to ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Failed to generate documentation:', err);
  process.exit(1);
}