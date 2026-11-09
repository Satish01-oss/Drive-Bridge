using System.Text.Json;

namespace DeviceBridge;

public enum DeviceSide { Right, Left, Above, Below }

public sealed record DeskLayout(DeviceSide Side = DeviceSide.Right, bool EdgeSwitch = true)
{
    static string Location => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceBridge", "layout.json");
    public static DeskLayout Load()
    {
        try { var saved = JsonSerializer.Deserialize<DeskLayout>(File.ReadAllText(Location)); return saved != null && Enum.IsDefined(saved.Side) ? saved : new(); }
        catch { return new(); }
    }
    public void Save() { Directory.CreateDirectory(Path.GetDirectoryName(Location)!); File.WriteAllText(Location, JsonSerializer.Serialize(this)); }
}

public static class DesktopGeometry
{
    public static DeviceSide Opposite(DeviceSide side) => side switch { DeviceSide.Right => DeviceSide.Left, DeviceSide.Left => DeviceSide.Right, DeviceSide.Above => DeviceSide.Below, _ => DeviceSide.Above };
    public static int Fraction(Rectangle bounds, Point point, DeviceSide side)
    {
        long value = side is DeviceSide.Left or DeviceSide.Right ? point.Y - bounds.Top : point.X - bounds.Left;
        int length = side is DeviceSide.Left or DeviceSide.Right ? bounds.Height : bounds.Width;
        return (int)Math.Clamp(value * 65535 / Math.Max(1, length - 1), 0, 65535);
    }
    public static Point Entry(Rectangle bounds, DeviceSide side, int fraction, bool otherPC)
    {
        var edge = otherPC ? Opposite(side) : side;
        int alongX = bounds.Left + (int)(Math.Clamp(fraction, 0, 65535) * (long)Math.Max(0, bounds.Width - 1) / 65535);
        int alongY = bounds.Top + (int)(Math.Clamp(fraction, 0, 65535) * (long)Math.Max(0, bounds.Height - 1) / 65535);
        int xInset = Math.Min(12, Math.Max(0, bounds.Width / 2 - 1)), yInset = Math.Min(12, Math.Max(0, bounds.Height / 2 - 1));
        return edge switch
        {
            DeviceSide.Left => new(bounds.Left + xInset, alongY),
            DeviceSide.Right => new(bounds.Right - 1 - xInset, alongY),
            DeviceSide.Above => new(alongX, bounds.Top + yInset),
            _ => new(alongX, bounds.Bottom - 1 - yInset)
        };
    }
    public static bool Crossing(Rectangle bounds, Point position, Point delta, DeviceSide edge) => edge switch
    {
        DeviceSide.Left => position.X <= bounds.Left + 1 && delta.X < 0,
        DeviceSide.Right => position.X >= bounds.Right - 2 && delta.X > 0,
        DeviceSide.Above => position.Y <= bounds.Top + 1 && delta.Y < 0,
        _ => position.Y >= bounds.Bottom - 2 && delta.Y > 0
    };
}

public sealed class ScreenLayoutPicker : UserControl
{
    DeviceSide selected;
    readonly Panel preview = new() { Width = 260, Dock = DockStyle.Left };
    public DeviceSide Selected => selected;
    public event Action<DeviceSide>? Changed;
    public ScreenLayoutPicker(DeviceSide side)
    {
        selected = side; Width = 630; Height = 118;
        var title = new Label { Text = "Where is the other PC's screen?", Dock = DockStyle.Top, Height = 26, Font = new Font("Segoe UI", 10, FontStyle.Bold) };
        var body = new Panel { Dock = DockStyle.Fill };
        var choices = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(8, 3, 0, 0) };
        foreach (var option in new[] { (DeviceSide.Left, "← Left"), (DeviceSide.Right, "Right →"), (DeviceSide.Above, "↑ Above"), (DeviceSide.Below, "↓ Below") })
        {
            var radio = new RadioButton { Text = option.Item2, Appearance = Appearance.Button, TextAlign = ContentAlignment.MiddleCenter, Width = 130, Height = 35, Checked = side == option.Item1 };
            radio.CheckedChanged += (_, _) => { if (radio.Checked) { selected = option.Item1; preview.Invalidate(); Changed?.Invoke(selected); } };
            choices.Controls.Add(radio);
        }
        preview.Paint += (_, e) =>
        {
            Point here = selected switch { DeviceSide.Left => new(155, 25), DeviceSide.Right => new(35, 25), DeviceSide.Above => new(95, 49), _ => new(95, 2) };
            Point there = selected switch { DeviceSide.Left => new(35, 25), DeviceSide.Right => new(155, 25), DeviceSide.Above => new(95, 2), _ => new(95, 49) };
            DrawScreen(e.Graphics, here, "This PC", Color.FromArgb(26, 111, 99));
            DrawScreen(e.Graphics, there, "Other PC", Color.FromArgb(80, 102, 119));
        };
        body.Controls.Add(choices); body.Controls.Add(preview); Controls.Add(body); Controls.Add(title);
    }
    static void DrawScreen(Graphics graphics, Point point, string title, Color color)
    {
        var rectangle = new Rectangle(point, new Size(84, 36)); using var brush = new SolidBrush(color); graphics.FillRectangle(brush, rectangle);
        TextRenderer.DrawText(graphics, title, SystemFonts.MessageBoxFont, rectangle, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}
