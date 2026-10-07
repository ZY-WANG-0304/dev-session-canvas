@echo off
> "%DSC_EXECUTION_PREFIX%-launcher-entered.txt" echo launcher-entered
"%DSC_EXECUTION_NODE%" "%DSC_EXECUTION_SUBJECT%" "%DSC_EXECUTION_PREFIX%"
set "DSC_EXECUTION_EXIT=%errorlevel%"
> "%DSC_EXECUTION_PREFIX%-launcher-exited.json" echo {"exitCode":%DSC_EXECUTION_EXIT%}
exit /b %DSC_EXECUTION_EXIT%
