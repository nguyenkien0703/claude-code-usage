FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Install x11vnc for remote browser access during setup
RUN apt-get update && apt-get install -y x11vnc && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Create required directories
RUN mkdir -p sessions data

EXPOSE 4455

CMD ["bash", "start.sh"]
