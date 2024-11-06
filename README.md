# Cratch RTMP Server

<img width="1269" alt="RTMP" src="https://github.com/user-attachments/assets/9daaaae0-3935-47ec-9c61-c20d589f147d">

# Overview

This repository hosts the **Cratch RTMP Server**, a custom-configured RTMP server powered by **Node-Media-Server** designed to support live streaming for the Cratch decentralized streaming platform. Optimized for high-quality, low-latency video streaming, the server also offers automated post-stream video saving, compression, and dynamic thumbnail generation, creating a smooth, efficient, and storage-friendly experience for both streamers and viewers.

# Features

- **High-Quality, Low-Latency Streaming:** Provides a stable, high-quality streaming environment suitable for real-time interaction on Cratch.
- **Automatic Video Saving:** Captures and saves each live stream video file upon completion, enabling creators to archive and reuse content effortlessly.
- **Video Compression:** Automatically compresses saved videos to reduce file size, optimizing storage while maintaining quality.
- **Dynamic Thumbnail Generation:** Generates updated thumbnails every minute during live streaming, giving viewers a preview of the current stream and increasing engagement.
- **Multi-Protocol Support:** Supports RTMP, HLS (HTTP Live Streaming), and DASH, making the streams accessible across various platforms and devices.
- **Adaptive Bitrate Streaming:** Adjusts streaming quality dynamically to maintain consistent viewing quality even on variable networks.
- **Access Control and Security:** Includes options for access control, such as token authentication and IP whitelisting, to prevent unauthorized streaming.
- **Scalability:** Architected to handle high demand and scale with the Cratch platform's growing user base.


# How It Works

1. **Stream Ingestion:** Streamers connect to the server using broadcasting software like OBS or Streamlabs to start a live session.
2. **Real-Time Thumbnail Creation:** While live, the server generates updated thumbnail snapshots every minute, providing a dynamic visual preview for viewers.
3. **Video Saving and Compression:** Once the live stream ends, the server automatically saves the video file and compresses it to optimize storage.
4. **Transcoding and Delivery:** The server transcodes and delivers the stream to viewers via multiple protocols (RTMP, HLS, DASH), ensuring compatibility across devices.
