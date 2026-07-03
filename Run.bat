cd "C:\git\ExtrairRAG-BancoDados"

net stop "TotvsRmDatabaseMcpServer2"
cmd.exe /c "git fetch"
cmd.exe /c "git pull"
cmd.exe /c "npm install"
cmd.exe /c "npm run extract"
net start "TotvsRmDatabaseMcpServer2"