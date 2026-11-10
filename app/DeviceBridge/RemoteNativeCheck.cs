using System.Security.Cryptography;
using System.Text.Json;
namespace DeviceBridge;
internal static class RemoteNativeCheck
{
 public static List<string> Run()
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
   int batches=0;var text="Remote typing — hello 👋";RemoteInput.WriteText(text,events=>{batches++;Check(new string(events.Where(e=>!e.Up).Select(e=>e.Unit).ToArray())==text&&events.Length==text.Length*2,"Remote Unicode text preserves surrogate pairs and balanced key releases");return (uint)events.Length;});Check(batches==1,"Remote text is injected as one atomic batch instead of interleaving per-character calls");
   bool invalid=false;try{RemoteInput.Key("RunShell");}catch(IOException){invalid=true;}Check(invalid,"Unknown remote key codes fail closed");
   using var grants=JsonDocument.Parse("[]");store.Set("grants",grants.RootElement);Check(store.Get("grants")?.GetArrayLength()==0,"Native grant records round trip through protected storage");
   bool unapproved=false;try{store.OwnGrant("unapproved-phone");}catch(IOException){unapproved=true;}Check(unapproved,"An unapproved phone cannot obtain native screen-capture permission");
   File.WriteAllBytes(Path.Combine(directory,"identity.bin"),new byte[]{0});bool corrupt=false;try{_=new RemoteProtectedStore(directory).PublicKey;}catch(CryptographicException){corrupt=true;}Check(corrupt,"Corrupt protected identity fails instead of silently replacing a trusted device key");
   return passed;
  }
  finally{foreach(var name in new[]{"identity.bin","grants.bin"}){var path=Path.Combine(directory,name);if(File.Exists(path))File.Delete(path);}if(Directory.Exists(directory))Directory.Delete(directory);}
 }
}
