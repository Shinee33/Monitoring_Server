# Start Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd server; node index.js" -WindowStyle Normal

# Start Frontend
npm run dev
