import { jest } from '@jest/globals';

// Provide test-only Azure credentials so config.azure.enabled = true.
// Real production secrets are no longer fall-backed in code (security).
process.env.AZURE_CLIENT_ID     = process.env.AZURE_CLIENT_ID     || 'test-client-id';
process.env.AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || 'test-client-secret';
process.env.AZURE_TENANT_ID     = process.env.AZURE_TENANT_ID     || 'test-tenant-id';
process.env.AZURE_GRAPH_MAIL_SCOPES = process.env.AZURE_GRAPH_MAIL_SCOPES
  || 'https://graph.microsoft.com/Mail.Send';

const mockAcquireTokenOnBehalfOf = jest.fn();
const mockAcquireTokenByClientCredential = jest.fn();

jest.unstable_mockModule('@azure/msal-node', () => ({
  ConfidentialClientApplication: jest.fn(() => ({
    acquireTokenOnBehalfOf: mockAcquireTokenOnBehalfOf,
    acquireTokenByClientCredential: mockAcquireTokenByClientCredential
  }))
}));

const { graphMailService, AzureMailNotConfiguredError } = await import('../graphMailService.js');
const { config } = await import('../../config/index.js');

describe('graphMailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAcquireTokenOnBehalfOf.mockResolvedValue({ accessToken: 'token-123' });
    mockAcquireTokenByClientCredential.mockResolvedValue({ accessToken: 'app-token-456' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: () => Promise.resolve('')
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('sends mail via Microsoft Graph', async () => {
    const payload = {
      message: {
        subject: 'Hello from Graph',
        body: { contentType: 'HTML', content: '<p>Hi there</p>' },
        toRecipients: [{ emailAddress: { address: 'someone@example.com' } }]
      },
      saveToSentItems: true
    };

    await graphMailService.sendMail('user-token', payload);

    expect(mockAcquireTokenOnBehalfOf).toHaveBeenCalledWith({
      oboAssertion: 'user-token',
      scopes: config.azure.mailScopes
    });

    expect(global.fetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/sendMail', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123'
      }),
      body: JSON.stringify(payload)
    }));
  });

  it('sends delegated mail via Microsoft Graph', async () => {
    const payload = {
      message: {
        subject: 'Delegated mail',
        body: { contentType: 'HTML', content: '<p>Hello</p>' },
        toRecipients: [{ emailAddress: { address: 'someone@example.com' } }]
      },
      saveToSentItems: true
    };

    await graphMailService.sendDelegatedMail('delegated-token', payload);

    expect(global.fetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/sendMail', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer delegated-token' }),
      body: JSON.stringify(payload)
    }));
  });

  it('sends application mail via Microsoft Graph', async () => {
    config.azure.mailSender = 'shared@contoso.com';
    graphMailService.mailSender = 'shared@contoso.com';

    const payload = {
      message: {
        subject: 'Hello from Graph',
        body: { contentType: 'HTML', content: '<p>Hi there</p>' },
        toRecipients: [{ emailAddress: { address: 'someone@example.com' } }]
      },
      saveToSentItems: true
    };

    await graphMailService.sendApplicationMail(payload);

    expect(mockAcquireTokenByClientCredential).toHaveBeenCalledWith({
      scopes: ['https://graph.microsoft.com/.default']
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/users/shared%40contoso.com/sendMail',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer app-token-456' }),
        body: JSON.stringify(payload)
      })
    );
  });

  it('throws when mail service disabled', async () => {
    const originalClientId = config.azure.clientId;
    const originalSecret = config.azure.clientSecret;
    config.azure.clientId = '';
    config.azure.clientSecret = '';

    const service = new (graphMailService.constructor)();

    await expect(service.sendMail('token', { message: {}, saveToSentItems: true })).rejects.toBeInstanceOf(AzureMailNotConfiguredError);

    config.azure.clientId = originalClientId;
    config.azure.clientSecret = originalSecret;
  });
});
