using System.Security.Cryptography;
using System.Text.Json;
namespace DeviceBridge;
internal static class RemoteNativeCheck
{
 public static async Task<List<string>> RunAsync()
 {
  var passed=new List<string>();void Check(bool value,string name){if(!value)throw new IOException(name);passed.Add(name);}
  var directory=Path.Combine(AppContext.BaseDirectory,"remote-test-"+Guid.NewGuid().ToString("N"));
  try
  {
   var store=new RemoteProtectedStore(directory);var publicKey=store.PublicKey;
   Check(new RemoteProtectedStore(directory).PublicKey==publicKey,"Native remote identity survives reload through CurrentUser-protected storage");
   using var value=JsonDocument.Parse("{\"z\":\"Hello 👋 नमस्ते \\u2028 quoted \\\" value\",\"a\":[1,true,null]}");
   var signature=store.Sign("grant",value.RootElement);
   Check(signature.Length==86&&signature==store.Sign("grant",value.RootElement),"Native Ed25519 signing is deterministic and returns the expected encoded length");
   Check(RemoteProtectedStore.Canonical(value.RootElement).StartsWith("{\"a\":[1,true,null],\"z\":"),"Native signed JSON sorts object keys and retains Unicode strings");
   File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"remote-contract-result.json"),JsonSerializer.Serialize(new{publicKey,purpose="grant",value=value.RootElement.Clone(),signature}));
   Check(RemoteInput.Key("KeyA")== (65,0)&&RemoteInput.Key("ControlRight")== (0xA3,1)&&RemoteInput.Key("ArrowLeft")== (37,1),"Remote keyboard mapping preserves letters and extended Windows keys without injecting input");
   var text="Remote typing — hello 👋 नमस्ते";var emitted=new List<char>();int pauses=0;
   await RemoteInput.WriteTextAsync(text,CancellationToken.None,events=>{if(events.Length!=2||events[0].Up||!events[1].Up||events[0].Unit!=events[1].Unit)throw new IOException("Unbalanced Unicode event pair");emitted.Add(events[0].Unit);return 2;},_=>{pauses++;return Task.CompletedTask;});
   Check(new string(emitted.ToArray())==text,"Paced remote Unicode text retains every UTF-16 unit and balanced key releases");
   Check(pauses==text.Length,"Remote typing yields between characters instead of blocking the app or flooding WinUI");
   using(var stop=new CancellationTokenSource()) { int delivered=0;bool cancelled=false;try{await RemoteInput.WriteTextAsync("abcdef",stop.Token,events=>{delivered++;return 2;},_=>{if(delivered==3)stop.Cancel();return Task.CompletedTask;});}catch(OperationCanceledException){cancelled=true;}Check(cancelled&&delivered==3,"Disconnect cancellation prevents remaining Unicode characters from being injected"); }
   using(var ordered=new RemoteInput()) { bool invalidText=false;try{await RemoteInput.WriteTextAsync("\ud800",CancellationToken.None,_=>throw new IOException("Invalid text reached injection"));}catch(System.Text.EncoderFallbackException){invalidText=true;}Check(invalidText,"Malformed UTF-16 is rejected before any keyboard injection"); }
   var deliveredInput=new List<string>();var hold=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
   using(var queue=new RemoteInput(async(value,token)=>{deliveredInput.Add(value);if(value=="first")await hold.Task.WaitAsync(token);},(value,_)=>deliveredInput.Add(value.GetProperty("type").GetString()!))) {
    void Enqueue(string json){using var packet=JsonDocument.Parse(json);queue.Apply(packet.RootElement,Rectangle.Empty);}
    Enqueue("{\"type\":\"text\",\"text\":\"first\"}");Enqueue("{\"type\":\"key\",\"code\":\"KeyA\",\"down\":true}");Enqueue("{\"type\":\"text\",\"text\":\"second\"}");hold.SetResult();await queue.Completion;
    Check(deliveredInput.SequenceEqual(new[]{"first","key","second"}),"Remote input queue preserves ordering and owns JSON beyond its request lifetime");
   }
   deliveredInput.Clear();var blocked=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
   using(var queue=new RemoteInput(async(value,token)=>{deliveredInput.Add(value);if(value=="first")await blocked.Task.WaitAsync(token);})) {
    void Enqueue(string textValue){using var packet=JsonDocument.Parse(JsonSerializer.Serialize(new{type="text",text=textValue}));queue.Apply(packet.RootElement,Rectangle.Empty);}
    Enqueue("first");Enqueue("stale");queue.Release();Enqueue("new session");await queue.Completion;
    Check(deliveredInput.SequenceEqual(new[]{"first","new session"}),"Stopping sharing clears pending text and a later session uses a fresh cancellation lifetime");
   }
   bool invalid=false;try{RemoteInput.Key("RunShell");}catch(IOException){invalid=true;}Check(invalid,"Unknown remote key codes fail closed");
   using var grants=JsonDocument.Parse("[]");store.Set("grants",grants.RootElement);Check(store.Get("grants")?.GetArrayLength()==0,"Native grant records round trip through protected storage");
   bool unapproved=false;try{store.OwnGrant("unapproved-phone");}catch(IOException){unapproved=true;}Check(unapproved,"An unapproved phone cannot obtain native screen-capture permission");
   File.WriteAllBytes(Path.Combine(directory,"identity.bin"),new byte[]{0});bool corrupt=false;try{_=new RemoteProtectedStore(directory).PublicKey;}catch(CryptographicException){corrupt=true;}Check(corrupt,"Corrupt protected identity fails instead of silently replacing a trusted device key");
   return passed;
  }
  finally{foreach(var name in new[]{"identity.bin","grants.bin"}){var path=Path.Combine(directory,name);if(File.Exists(path))File.Delete(path);}if(Directory.Exists(directory))Directory.Delete(directory);}
 }
}
