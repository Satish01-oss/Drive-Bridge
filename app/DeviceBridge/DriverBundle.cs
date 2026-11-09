using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;

namespace DeviceBridge;

public static class DriverBundle
{
    public const string PackageHash = "BC44E8974191A5A2427D6C979E2DAB08DBB09925F3F435DFA2F0BA3E45B6EB90";
    public static byte[] ReadPackage()
    {
        var assembly = typeof(DriverBundle).Assembly;
        var name = assembly.GetManifestResourceNames().Single(n => n.EndsWith("VBCABLE_Driver_Pack46.zip", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var bytes = new MemoryStream(); stream.CopyTo(bytes);
        var result = bytes.ToArray();
        if (Convert.ToHexString(SHA256.HashData(result)) != PackageHash) throw new IOException("The included microphone package failed its integrity check.");
        return result;
    }
    public static string ReadLicense()
    {
        using var stream = new MemoryStream(ReadPackage()); using var zip = new ZipArchive(stream);
        using var reader = new StreamReader(zip.Entries.Single(e => e.Name.Equals("readme.txt", StringComparison.OrdinalIgnoreCase)).Open());
        return reader.ReadToEnd();
    }
    public static string Extract(string directory)
    {
        Directory.CreateDirectory(directory);
        // Keep the original archive alongside its unmodified contents.
        var bytes = ReadPackage(); File.WriteAllBytes(Path.Combine(directory, "VBCABLE_Driver_Pack46.zip"), bytes);
        using var stream = new MemoryStream(bytes);
        ZipFile.ExtractToDirectory(stream, directory, true);
        return Directory.GetFiles(directory, "VBCABLE_Setup_x64.exe", SearchOption.AllDirectories).Single();
    }
    public static int CableOutputId()
    {
        var outputs = AudioBridge.Outputs();
        try
        {
            using var devices = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            using var defaultOutput = devices.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.Role.Multimedia);
            // VB-CABLE's stereo and 16-channel playback pins cannot be opened
            // simultaneously. Reuse the pin Windows already selected.
            if (defaultOutput.FriendlyName.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase))
            {
                return ChooseCableOutput(outputs, defaultOutput.FriendlyName);
            }
        }
        catch { }
        return ChooseCableOutput(outputs, null);
    }
    internal static int ChooseCableOutput(List<(int Id, string Name)> outputs, string? preferred)
    {
        if (preferred?.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase) == true)
        {
            var match = outputs.FirstOrDefault(o => o.Id >= 0 && preferred.StartsWith(o.Name, StringComparison.OrdinalIgnoreCase));
            if (match.Name != null) return match.Id;
        }
        return outputs.Where(x => x.Name.StartsWith("CABLE Input", StringComparison.OrdinalIgnoreCase)).Select(x => x.Id).DefaultIfEmpty(-2).First();
    }
}

public sealed class MicrophoneSetupForm : Form
{
    public MicrophoneSetupForm()
    {
        Text = "DeviceBridge · Microphone setup"; ClientSize = new Size(660, 620); Font = new Font("Segoe UI", 10);
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), RowCount = 6, ColumnCount = 1 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 85)); root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48)); root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48)); root.RowStyles.Add(new RowStyle(SizeType.Absolute, 100)); root.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));
        root.Controls.Add(new Label { Text = "Microphone driver included — no extra download\n\nVB-CABLE by VB-Audio · www.vb-cable.com\nDonationware: contributions and license purchases are welcome.", Dock = DockStyle.Fill });
        root.Controls.Add(new RichTextBox { Text = DriverBundle.ReadLicense(), ReadOnly = true, Dock = DockStyle.Fill, BackColor = Color.White });
        var consent = new CheckBox { Text = "I have read the VB-CABLE license and want to install the driver.", Dock = DockStyle.Fill }; root.Controls.Add(consent);
        var install = new Button { Text = "Open microphone driver installer", Enabled = false, Dock = DockStyle.Fill }; root.Controls.Add(install);
        var note = new Label { Text = "Windows will ask for administrator approval. Follow the VB-CABLE installer, restart this PC, then reopen DeviceBridge. In your calling app, choose CABLE Output as the microphone.", Dock = DockStyle.Fill }; root.Controls.Add(note);
        consent.CheckedChanged += (_, _) => install.Enabled = consent.Checked;
        install.Click += async (_, _) =>
        {
            install.Enabled = false;
            try
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "Driver", Guid.NewGuid().ToString("N"));
                var setup = DriverBundle.Extract(folder);
                using var process = Process.Start(new ProcessStartInfo(setup) { WorkingDirectory = Path.GetDirectoryName(setup)!, UseShellExecute = true, Verb = "runas" });
                if (process != null) await process.WaitForExitAsync();
                note.Text = "If installation succeeded, restart this PC before using the microphone. DeviceBridge will select the cable automatically next time. Select CABLE Output in your calling app.";
            }
            catch (System.ComponentModel.Win32Exception) { note.Text = "Setup was cancelled or couldn't open. Nothing else was downloaded. You can try again when ready."; }
            catch (Exception) { note.Text = "The included driver could not be prepared. Please try downloading DeviceBridge again from its website."; }
            finally { install.Enabled = consent.Checked; }
        };
        var support = new LinkLabel { Text = "Support VB-Audio / licensing", AutoSize = true };
        support.LinkClicked += (_, _) => Process.Start(new ProcessStartInfo("https://vb-audio.com/Services/licensing.htm") { UseShellExecute = true });
        root.Controls.Add(support);
        // The vendor and donationware notice remain visible before any installation.
        note.Text += " Professional deployments require appropriate VB-Audio licensing.";
        Controls.Add(root);
    }
}
