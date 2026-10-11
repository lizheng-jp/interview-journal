"""Decode audio rather than trusting MIME, filename or client duration."""
from pathlib import Path
import av

MAX_SECONDS = 12 * 3600

def probe_audio(path: Path) -> float:
    try:
        with av.open(str(path)) as container:
            if not container.streams.audio or container.streams.video:
                raise ValueError('Upload an audio-only recording')
            seconds = 0.0
            for frame in container.decode(audio=0):
                seconds += frame.samples / frame.sample_rate
                if seconds > MAX_SECONDS:
                    raise ValueError('Recording exceeds 12 hours')
            if seconds <= 0:
                raise ValueError('No decodable audio found')
            return round(seconds, 3)
    except (av.error.FFmpegError, OSError) as exc:
        raise ValueError('Invalid or damaged audio file') from exc


def prepare_audio(path: Path) -> float:
    seconds = probe_audio(path)
    if path.suffix == '.webm':
        # MediaRecorder emits a streaming WebM header without duration/cues.
        # Remux without re-encoding so browsers can seek and display a finite duration.
        temporary = path.with_suffix('.remux')
        try:
            with av.open(str(path)) as source, av.open(str(temporary), mode='w', format='webm') as output:
                stream = output.add_stream_from_template(source.streams.audio[0])
                for packet in source.demux(audio=0):
                    if packet.dts is not None:
                        packet.stream = stream
                        output.mux(packet)
            temporary.replace(path)
        except av.error.FFmpegError as exc:
            raise ValueError('Unsupported WebM audio codec') from exc
        finally:
            temporary.unlink(missing_ok=True)
    return seconds
