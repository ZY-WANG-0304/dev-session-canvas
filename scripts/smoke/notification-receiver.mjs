import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../gates/process.mjs';

export function systemPowerShell() {
  assert(process.env.SystemRoot,'Windows system directory is required');
  return path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
}
export function readNotificationInvocation(record,platform=process.platform) {
  assert(Array.isArray(record?.args)&&record.args.every(arg=>typeof arg==='string'));
  const args=record.args;
  if(platform==='linux') {
    assert(args.includes('--wait')&&args.some(arg=>arg.startsWith('--action=view=')));
    return {title:args.at(-2),message:args.at(-1),callback:'direct-action'};
  }
  if(platform==='darwin') {
    const read=name=>{const index=args.indexOf(name);assert(index>=0&&args[index+1]);return args[index+1];};
    return {title:read('-title'),message:read('-message'),callback:read('-open')};
  }
  assert.equal(platform,'win32');const index=args.indexOf('-EncodedCommand');assert(index>=0&&args[index+1]);
  const script=Buffer.from(args[index+1],'base64').toString('utf16le');
  assert(script.includes('ToastNotificationManager')&&script.includes('$notifier.Show($toast)'));
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const texts=[...script.matchAll(/<text>(.*?)<\/text>/gs)].map(match=>decode(match[1]));assert.equal(texts.length,2);
  const callback=script.match(/activationType="protocol" launch="([^"]+)"/);assert(callback);
  return {title:texts[0],message:texts[1],callback:decode(callback[1]),script};
}

// The product launches its normal OS backend. This private receiver replaces
// only the external notification executable, allowing delivery and click
// routing to be observed without a real desktop notification service.
export async function prepareNotificationReceiver(directory,deadline) {
  await fs.mkdir(directory,{recursive:true});
  const capture=path.join(directory,'invocation.json');const release=path.join(directory,'activate.flag');
  const name={linux:'notify-send',darwin:'terminal-notifier',win32:'powershell.exe'}[process.platform];assert(name);
  if(process.platform!=='win32') {
    const script=`#!${process.execPath}\nconst fs=require('node:fs');
const capture=process.env.DSC_NOTIFICATION_CAPTURE;const tmp=capture+'.'+process.pid+'.pending';
fs.writeFileSync(tmp,JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));fs.renameSync(tmp,capture);
if(process.platform==='linux'&&process.argv.includes('--wait')){
const deadline=Date.now()+20000;const timer=setInterval(()=>{
if(fs.existsSync(process.env.DSC_NOTIFICATION_ACTIVATE)){clearInterval(timer);process.stdout.write('view\\n');}
else if(Date.now()>=deadline){clearInterval(timer);process.exitCode=1;}
},25);}
`;
    await fs.writeFile(path.join(directory,name),script,{flag:'wx',mode:0o755});
  } else {
    const source=path.join(directory,'receiver.cs'),compile=path.join(directory,'compile.ps1');
    await fs.writeFile(source,`using System;using System.IO;using System.Web.Script.Serialization;
public static class Receiver{public static int Main(string[] args){
if(Array.IndexOf(args,"-EncodedCommand")<0)return 2;
var pid=System.Diagnostics.Process.GetCurrentProcess().Id;var capture=Environment.GetEnvironmentVariable("DSC_NOTIFICATION_CAPTURE");
var temporary=capture+"."+pid+".pending";File.WriteAllText(temporary,new JavaScriptSerializer().Serialize(new{pid=pid,args=args}));
if(File.Exists(capture))File.Replace(temporary,capture,null);else File.Move(temporary,capture);return 0;}}\n`,{flag:'wx'});
    const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
    await fs.writeFile(compile,`Add-Type -TypeDefinition (Get-Content -Raw ${psQuote(source)}) -ReferencedAssemblies System.Web.Extensions -OutputAssembly ${psQuote(path.join(directory,name))} -OutputType ConsoleApplication\n`,{flag:'wx'});
    const result=await runProcess(systemPowerShell(),['-NoProfile','-NonInteractive','-File',compile],
      {deadline,logPath:path.join(directory,'compile.log')});assert.equal(result.status,'passed');
  }
  return {capture,release,executable:path.join(directory,name),env:{
    PATH:`${directory}${path.delimiter}${process.env.PATH??''}`,DSC_NOTIFICATION_CAPTURE:capture,DSC_NOTIFICATION_ACTIVATE:release}};
}
