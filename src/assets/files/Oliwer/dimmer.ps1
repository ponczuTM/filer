param(
    [ValidateRange(1, 100)]
    [int]$brightness
)

if ($brightness -lt 1) { $brightness = 1 }

$code = @"
using System;
using System.Runtime.InteropServices;

public class BrightnessControl {
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("gdi32.dll")]
    public static extern bool SetDeviceGammaRamp(IntPtr hDC, byte[] lpRamp);

    public static void SetBrightness(int brightness) {
        IntPtr hDC = GetDC(IntPtr.Zero);
        byte[] ramp = new byte[1536];

        // Wyliczamy mnożnik tak, aby 100% jasności dawało standardową krzywą.
        // Używamy skali 0-255 dla łatwiejszej manipulacji bajtami.
        for (int i = 0; i < 256; i++) {
            // Kluczowa zmiana: używamy double do precyzyjnych obliczeń
            // Wartość i * (brightness/100) daje liniowe przyciemnienie
            int val = (int)(i * (brightness / 100.0));
            
            // Windows w 8-bitowej reprezentacji SetDeviceGammaRamp 
            // oczekuje wartości przesuniętej o 8 bitów (dlatego zapisujemy w drugim bajcie)
            ramp[i * 2 + 1] = (byte)val; 
            ramp[i * 2 + 513] = (byte)val;
            ramp[i * 2 + 1025] = (byte)val;
            
            // Pierwszy bajt (Low Byte) zostawiamy na 0 dla stabilności
        }
        
        SetDeviceGammaRamp(hDC, ramp);
    }
}
"@

Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[BrightnessControl]::SetBrightness($brightness)

Write-Host "Jasność ustawiona na: $brightness %"