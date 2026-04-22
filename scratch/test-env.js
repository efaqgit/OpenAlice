// Test script to verify environment variable loading
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
    console.log('process.loadEnvFile() executed');
  } else {
    console.log('process.loadEnvFile is not a function');
  }
} catch (e) {
  console.log('Error loading .env file:', e.message);
}

console.log('GOOGLE_API_KEY exists:', !!process.env.GOOGLE_API_KEY);
if (process.env.GOOGLE_API_KEY) {
  console.log('GOOGLE_API_KEY prefix:', process.env.GOOGLE_API_KEY.substring(0, 10));
}
