"""Small deterministic PCM helpers used by the current ensemble rehearsal renderer.

This module is not a Singing audio pipeline. Student singing uses browser piano,
fixed solfege samples, and the teacher-uploaded original MP3.
"""
from __future__ import annotations

from array import array
import io
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import wave

SAMPLE_RATE = 48_000
NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SOLFEGE_VOWELS = {
    "do": ((500, 900, 2400), "d"), "re": ((530, 1840, 2480), "r"),
    "mi": ((270, 2290, 3010), "m"), "fa": ((730, 1090, 2440), "f"),
    "sol": ((500, 900, 2400), "s"), "so": ((500, 900, 2400), "s"),
    "la": ((730, 1090, 2440), "l"), "si": ((270, 2290, 3010), "s"),
    "ti": ((270, 2290, 3010), "t"),
}

def _midi_from_pitch(value: str | None) -> int | None:
    if not value: return None
    match = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d+)", str(value).strip())
    if not match: raise ValueError(f"无法解析绝对音高：{value}")
    letter, accidental, octave_text = match.groups()
    semitone = NOTE_BASE[letter.upper()] + (1 if accidental == "#" else -1 if accidental == "b" else 0)
    return (int(octave_text) + 1) * 12 + semitone

def _frequency(value: str | None) -> float | None:
    midi = _midi_from_pitch(value)
    return None if midi is None else 440.0 * (2.0 ** ((midi - 69) / 12.0))

def _beat_seconds(bpm: float) -> float:
    if bpm <= 0: raise ValueError("BPM 必须大于 0。")
    return 60.0 / bpm

def _silence(seconds: float) -> array:
    return array("h", [0]) * max(1, int(round(seconds * SAMPLE_RATE)))

def _mix(target: array, source: array, start_sample: int, gain: float = 1.0) -> None:
    if gain <= 0: return
    end = min(len(target), start_sample + len(source))
    for ti, si in zip(range(start_sample, end), range(end - start_sample)):
        target[ti] = max(-32768, min(32767, target[ti] + int(source[si] * gain)))

def _soft_clip(value: float) -> int:
    return max(-32768, min(32767, int(value)))

def _piano_tone(freq: float, seconds: float, amplitude: float = 7600) -> array:
    count=max(1,int(seconds*SAMPLE_RATE));out=array("h",[0])*count;attack=max(1,int(.006*SAMPLE_RATE));release=max(1,int(min(.18,seconds*.35)*SAMPLE_RATE));harmonics=[(1,1.0),(2,.48),(3,.23),(4,.12),(5,.07)]
    for i in range(count):
        t=i/SAMPLE_RATE;env=min(1.0,i/attack)*min(1.0,(count-i)/release);env*=math.exp(-2.8*t/max(.2,seconds));value=sum(gain*math.sin(2*math.pi*freq*mult*t) for mult,gain in harmonics);out[i]=_soft_clip(amplitude*env*value/1.7)
    return out

def _click(freq: float = 1100.0, seconds: float = 0.055, amplitude: float = 6500) -> array:
    count=max(1,int(seconds*SAMPLE_RATE));out=array("h",[0])*count
    for i in range(count):
        t=i/SAMPLE_RATE;out[i]=_soft_clip(amplitude*math.exp(-45*t)*math.sin(2*math.pi*freq*t))
    return out

def _vocal_like_tone(freq: float, seconds: float, token: str) -> array:
    formants,consonant=SOLFEGE_VOWELS.get(str(token or "").lower(),((500,1500,2500),""));count=max(1,int(seconds*SAMPLE_RATE));out=array("h",[0])*count;attack=max(1,int(.018*SAMPLE_RATE));release=max(1,int(min(.12,seconds*.3)*SAMPLE_RATE));harmonic_count=max(5,min(28,int(5000/max(freq,80))))
    for i in range(count):
        t=i/SAMPLE_RATE;env=min(1.0,i/attack)*min(1.0,(count-i)/release);env*=.92+.08*math.sin(2*math.pi*5.2*t);value=0.0;norm=0.0
        for h in range(1,harmonic_count+1):
            hf=h*freq;resonance=.12
            for fi,formant in enumerate(formants):
                bw=(130,190,260)[fi];resonance+=math.exp(-((hf-formant)/bw)**2)*(1.0,.65,.35)[fi]
            gain=resonance/(h**1.18);value+=gain*math.sin(2*math.pi*hf*t+h*.03);norm+=gain
        value/=max(norm,.001);onset=0.0
        if i<int(.055*SAMPLE_RATE) and consonant in {"s","f","t","d","r","l"}:
            onset=math.sin(2*math.pi*(3200 if consonant in {"s","f"} else 900)*t)*(1-i/max(1,int(.055*SAMPLE_RATE)))*(.35 if consonant in {"s","f"} else .18)
        out[i]=_soft_clip(11500*env*(value+onset))
    return out

def _decode_pcm16_wav_bytes(content: bytes) -> tuple[array, int]:
    with wave.open(io.BytesIO(content),"rb") as reader:
        channels=reader.getnchannels();width=reader.getsampwidth();rate=reader.getframerate()
        if width!=2: raise ValueError("TTS WAV 必须是 16-bit PCM。")
        raw=array("h");raw.frombytes(reader.readframes(reader.getnframes()))
        if channels==1:return raw,rate
        mono=array("h")
        for i in range(0,len(raw),channels):mono.append(int(sum(raw[i:i+channels])/channels))
        return mono,rate

def _resample_linear(samples: array, source_rate: int, target_rate: int = SAMPLE_RATE) -> array:
    if source_rate==target_rate or len(samples)<2:return array("h",samples)
    count=max(1,int(round(len(samples)*target_rate/source_rate)));out=array("h",[0])*count;scale=(len(samples)-1)/max(1,count-1)
    for i in range(count):
        pos=i*scale;left=int(pos);right=min(left+1,len(samples)-1);frac=pos-left;out[i]=_soft_clip(samples[left]*(1-frac)+samples[right]*frac)
    return out

def _fit_samples_to_seconds(samples: array, seconds: float) -> array:
    count=max(1,int(round(seconds*SAMPLE_RATE)))
    if len(samples)==count:return samples
    if len(samples)<2:return array("h",[0])*count
    out=array("h",[0])*count;scale=(len(samples)-1)/max(1,count-1)
    for i in range(count):
        pos=i*scale;left=int(pos);right=min(left+1,len(samples)-1);frac=pos-left;out[i]=_soft_clip(samples[left]*(1-frac)+samples[right]*frac)
    return out

def _espeak_lyric_token(token: str, target_pitch: str | None, seconds: float) -> array:
    binary=shutil.which("espeak") or shutil.which("espeak-ng")
    if binary:
        midi=_midi_from_pitch(target_pitch) if target_pitch else 60;pitch_value=max(15,min(85,int(round(50+(midi-60)*1.8))));result=subprocess.run([binary,"-v","zh","-s","125","-p",str(pitch_value),"--stdout",str(token)],capture_output=True,check=False,timeout=10)
        if result.returncode!=0 or not result.stdout: raise RuntimeError("普通话离线 TTS 生成失败。")
        wav_bytes=result.stdout
    else:
        say=shutil.which("say")
        if not say: raise RuntimeError("合奏排练引导声需要 espeak/espeak-ng 或 macOS say（仅本地开发 fallback）。")
        with tempfile.TemporaryDirectory(prefix="animalbank-tts-") as directory:
            output=Path(directory)/"token.wav";result=subprocess.run([say,"-r","125","-o",str(output),"--file-format=WAVE","--data-format=LEI16@22050",str(token)],capture_output=True,check=False,timeout=10)
            if result.returncode!=0 or not output.is_file(): raise RuntimeError("macOS 离线 TTS 生成失败。")
            wav_bytes=output.read_bytes()
    samples,rate=_decode_pcm16_wav_bytes(wav_bytes)
    return _fit_samples_to_seconds(_resample_linear(samples,rate),seconds)
