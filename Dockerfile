# filepath: /home/davidr/development/workspace-tools/Dockerfile
# Use the official Node.js image as the base image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port your app runs on (if applicable)
EXPOSE 8080

# Set the command to run your app
CMD ["npm", "start"]