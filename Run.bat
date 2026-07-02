cd "C:\git\ExtrairRAG-BancoDados"

cmd.exe /c "git fetch"
cmd.exe /c "git pull"
cmd.exe /c "npm install"
cmd.exe /c "npm run extract"
net stop "TotvsRmDatabaseMcpServer2"
net start "TotvsRmDatabaseMcpServer2"