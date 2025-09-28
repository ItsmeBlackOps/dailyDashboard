import { io } from 'socket.io-client';
import fs from 'fs';

// Configuration
const SERVER_URL = 'http://localhost:3005';
const TEST_CREDENTIALS = {
  email: 'harsh.patel@silverspaceinc.com',
  password: 'Hkpatel@21'
};

const outputFile = 'socket-test-outputs.json';

class SocketTestClient {
  constructor() {
    this.socket = null;
    this.outputs = {
      timestamp: new Date().toISOString(),
      testCredentials: TEST_CREDENTIALS,
      socketEvents: {},
      errors: []
    };
  }

  logOutput(eventName, data, type = 'emit') {
    const timestamp = new Date().toISOString();
    if (!this.outputs.socketEvents[eventName]) {
      this.outputs.socketEvents[eventName] = [];
    }

    this.outputs.socketEvents[eventName].push({
      type,
      timestamp,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid circular refs
    });

    console.log(`[${timestamp}] ${type.toUpperCase()} ${eventName}:`, JSON.stringify(data, null, 2));
  }

  logError(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorData = {
      timestamp,
      context,
      error: error.message || error,
      stack: error.stack
    };

    this.outputs.errors.push(errorData);
    console.error(`[${timestamp}] ERROR ${context}:`, error);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(SERVER_URL, {
          timeout: 10000,
          transports: ['websocket', 'polling']
        });

        // Connection events
        this.socket.on('connect', () => {
          console.log('✅ Connected to server');
          this.logOutput('connect', { socketId: this.socket.id }, 'event');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('❌ Connection error:', error);
          this.logError(error, 'connect_error');
          reject(error);
        });

        this.socket.on('disconnect', (reason) => {
          console.log('🔌 Disconnected:', reason);
          this.logOutput('disconnect', { reason }, 'event');
        });

        // Error handling
        this.socket.on('error', (error) => {
          this.logError(error, 'socket_error');
        });

        // Generic event listener for any server events
        const originalOn = this.socket.on.bind(this.socket);
        this.socket.on = (event, handler) => {
          return originalOn(event, (...args) => {
            if (!['connect', 'disconnect', 'connect_error', 'error'].includes(event)) {
              this.logOutput(event, args, 'received');
            }
            return handler(...args);
          });
        };

      } catch (error) {
        this.logError(error, 'connect');
        reject(error);
      }
    });
  }

  async testLogin() {
    return new Promise((resolve, reject) => {
      console.log('\n🔐 Testing login...');

      const loginData = {
        email: TEST_CREDENTIALS.email,
        password: TEST_CREDENTIALS.password
      };

      this.logOutput('login', loginData, 'emit');

      this.socket.emit('login', loginData, (response) => {
        this.logOutput('login', response, 'callback');

        if (response.success) {
          console.log('✅ Login successful');
          this.userTokens = {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken
          };
          resolve(response);
        } else {
          console.log('❌ Login failed:', response.error);
          reject(new Error(response.error));
        }
      });

      // Timeout
      setTimeout(() => {
        reject(new Error('Login timeout'));
      }, 10000);
    });
  }

  async testPing() {
    return new Promise((resolve) => {
      console.log('\n🏓 Testing ping...');

      this.logOutput('ping', {}, 'emit');

      this.socket.emit('ping', (response) => {
        this.logOutput('ping', response, 'callback');
        console.log('✅ Ping response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 5000);
    });
  }

  async testGetUserInfo() {
    return new Promise((resolve) => {
      console.log('\n👤 Testing getUserInfo...');

      this.logOutput('getUserInfo', {}, 'emit');

      this.socket.emit('getUserInfo', (response) => {
        this.logOutput('getUserInfo', response, 'callback');
        console.log('✅ UserInfo response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 5000);
    });
  }

  async testGetTasksToday() {
    return new Promise((resolve) => {
      console.log('\n📋 Testing getTasksToday...');

      const taskData = { tab: "Date of Interview" };
      this.logOutput('getTasksToday', taskData, 'emit');

      this.socket.emit('getTasksToday', taskData, (response) => {
        this.logOutput('getTasksToday', response, 'callback');
        console.log('✅ TasksToday response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 10000);
    });
  }

  async testGetDashboardSummary() {
    return new Promise((resolve) => {
      console.log('\n📊 Testing getDashboardSummary...');

      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const dashboardData = {
        start: startOfDay.toISOString(),
        end: endOfDay.toISOString()
      };

      this.logOutput('getDashboardSummary', dashboardData, 'emit');

      this.socket.emit('getDashboardSummary', dashboardData, (response) => {
        this.logOutput('getDashboardSummary', response, 'callback');
        console.log('✅ DashboardSummary response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 10000);
    });
  }

  async testSearchTasks() {
    return new Promise((resolve) => {
      console.log('\n🔍 Testing searchTasks...');

      const searchData = {
        search: "interview",
        limit: 10
      };

      this.logOutput('searchTasks', searchData, 'emit');

      this.socket.emit('searchTasks', searchData, (response) => {
        this.logOutput('searchTasks', response, 'callback');
        console.log('✅ SearchTasks response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 10000);
    });
  }

  async testGetTaskStatistics() {
    return new Promise((resolve) => {
      console.log('\n📈 Testing getTaskStatistics...');

      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - 7);

      const statsData = {
        start: startOfWeek.toISOString(),
        end: today.toISOString()
      };

      this.logOutput('getTaskStatistics', statsData, 'emit');

      this.socket.emit('getTaskStatistics', statsData, (response) => {
        this.logOutput('getTaskStatistics', response, 'callback');
        console.log('✅ TaskStatistics response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 10000);
    });
  }

  async testRefreshToken() {
    if (!this.userTokens?.refreshToken) {
      console.log('⚠️ No refresh token available, skipping refresh test');
      return null;
    }

    return new Promise((resolve) => {
      console.log('\n🔄 Testing refresh token...');

      const refreshData = { refreshToken: this.userTokens.refreshToken };
      this.logOutput('refresh', refreshData, 'emit');

      this.socket.emit('refresh', refreshData, (response) => {
        this.logOutput('refresh', response, 'callback');
        console.log('✅ Refresh response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 5000);
    });
  }

  async testLogout() {
    if (!this.userTokens?.refreshToken) {
      console.log('⚠️ No refresh token available, skipping logout test');
      return null;
    }

    return new Promise((resolve) => {
      console.log('\n👋 Testing logout...');

      const logoutData = { refreshToken: this.userTokens.refreshToken };
      this.logOutput('logout', logoutData, 'emit');

      this.socket.emit('logout', logoutData, (response) => {
        this.logOutput('logout', response, 'callback');
        console.log('✅ Logout response received');
        resolve(response);
      });

      setTimeout(() => {
        resolve(null);
      }, 5000);
    });
  }

  async runAllTests() {
    try {
      console.log('🚀 Starting socket test client...');

      // Connect
      await this.connect();

      // Test login first
      await this.testLogin();

      // Wait a bit for authentication to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test all other endpoints
      await this.testPing();
      await this.testGetUserInfo();
      await this.testGetTasksToday();
      await this.testGetDashboardSummary();
      await this.testSearchTasks();
      await this.testGetTaskStatistics();
      await this.testRefreshToken();

      // Test logout last
      await this.testLogout();

      console.log('\n✅ All tests completed');

    } catch (error) {
      this.logError(error, 'runAllTests');
      console.error('\n❌ Test run failed:', error.message);
    } finally {
      // Save outputs to file
      this.saveOutputs();

      // Disconnect
      if (this.socket) {
        this.socket.disconnect();
      }
    }
  }

  saveOutputs() {
    try {
      fs.writeFileSync(outputFile, JSON.stringify(this.outputs, null, 2));
      console.log(`\n📁 Outputs saved to ${outputFile}`);
    } catch (error) {
      this.logError(error, 'saveOutputs');
    }
  }
}

// Run the tests
const client = new SocketTestClient();
client.runAllTests().then(() => {
  console.log('\n🎉 Socket testing complete!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Socket testing failed:', error);
  process.exit(1);
});