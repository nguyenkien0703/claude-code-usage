FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Create required directories
RUN mkdir -p sessions data

EXPOSE 4455

CMD ["bash", "start.sh"]
