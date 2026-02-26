FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Create required directories
RUN mkdir -p sessions data

EXPOSE 3000

CMD ["bash", "start.sh"]
