const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const filePath = path.join(__dirname, 'flight-editor.html');
  const html = fs.readFileSync(filePath, 'utf8');
  
  // Find script content
  const startTag = '<script>';
  const endTag = '</script>';
  const startIndex = html.indexOf(startTag);
  const endIndex = html.indexOf(endTag, startIndex);
  
  if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find script tags in flight-editor.html');
    process.exit(1);
  }
  
  const scriptContent = html.substring(startIndex + startTag.length, endIndex);
  const tempPath = path.join(__dirname, 'temp_script.js');
  fs.writeFileSync(tempPath, scriptContent, 'utf8');
  
  console.log('Running node --check on extracted JS code...');
  try {
    const output = execSync(`node --check "${tempPath}"`, { encoding: 'utf8', stdio: 'pipe' });
    console.log('SUCCESS: Extracted JS code has clean syntax!');
  } catch (err) {
    console.error('SYNTAX ERROR DETECTED:');
    console.error(err.stderr || err.message);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
} catch (e) {
  console.error('Error running check:', e);
}
