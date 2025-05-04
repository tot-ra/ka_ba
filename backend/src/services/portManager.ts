import net from 'net';

export class PortManager {
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: any) => {
        resolve(err.code !== 'EADDRINUSE');
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  private async findAvailablePort(startPort = 10000, endPort = 65535, maxAttempts = 100): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
      const isAvailable = await this.checkPort(port);
      if (isAvailable) {
        console.log(`Found available port: ${port}`);
        return port;
      }
    }
    throw new Error(`Could not find an available port after ${maxAttempts} attempts.`);
  }

  public async determinePort(requestedPort: number | null | undefined): Promise<number> {
      if (requestedPort && requestedPort > 0) {
        console.log(`Requested specific port: ${requestedPort}`);
        const isAvailable = await this.checkPort(requestedPort);
        if (isAvailable) {
          console.log(`Using requested port ${requestedPort}`);
          return requestedPort;
        } else {
          throw new Error(`Port ${requestedPort} is already in use.`);
        }
      } else {
        console.log('No specific port requested or port is 0, finding random available port...');
        return this.findAvailablePort();
      }
  }
}
