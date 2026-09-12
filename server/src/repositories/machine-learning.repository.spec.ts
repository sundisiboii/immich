import { defaults, MachineLearningConfig } from 'src/dtos/config.dto';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { automock } from 'test/utils';

const response = (ok: boolean, body: unknown = { clip: 'result' }): Partial<Response> => ({
  ok,
  status: ok ? 200 : 401,
  statusText: ok ? 'OK' : 'Unauthorized',
  json: () => Promise.resolve(body),
});

describe(MachineLearningRepository.name, () => {
  let sut: MachineLearningRepository;
  let config: MachineLearningConfig;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MachineLearningRepository(
      automock(LoggingRepository, {
        args: [, { getEnv: () => ({}) }],
        strict: false,
      }),
    );
    config = structuredClone(defaults.machineLearning);
  });

  afterEach(() => {
    sut?.teardown();
    vi.unstubAllGlobals();
  });

  it('does not authenticate legacy endpoint requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(true));
    vi.stubGlobal('fetch', fetchMock);
    config.urls = ['http://immich-machine-learning:3003'];
    config.availabilityChecks.enabled = false;
    sut.setup(config);

    await sut.encodeText('test', { modelName: 'model' });

    expect(fetchMock).toHaveBeenCalledWith(new URL('http://immich-machine-learning:3003/predict'), {
      method: 'POST',
      body: expect.any(FormData),
      headers: undefined,
    });
  });

  it('authenticates availability and prediction requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(true));
    vi.stubGlobal('fetch', fetchMock);
    config.urls = [
      {
        url: 'https://ml.example.com',
        auth: { username: 'immich', password: 'secret' },
      },
    ];
    sut.setup(config);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://ml.example.com/ping'), {
      headers: { Authorization: 'Basic aW1taWNoOnNlY3JldA==' },
      signal: expect.any(AbortSignal),
    });

    await sut.encodeText('test', { modelName: 'model' });
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://ml.example.com/predict'), {
      method: 'POST',
      body: expect.any(FormData),
      headers: { Authorization: 'Basic aW1taWNoOnNlY3JldA==' },
    });
  });

  it('keeps credentials isolated while falling back between endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(false))
      .mockResolvedValueOnce(response(false))
      .mockResolvedValueOnce(response(true));
    vi.stubGlobal('fetch', fetchMock);
    config.availabilityChecks.enabled = false;
    config.urls = [
      {
        url: 'https://ml-a.example.com',
        auth: { username: 'a', password: 'password-a' },
      },
      {
        url: 'https://ml-b.example.com',
        auth: { username: 'b', password: 'password-b' },
      },
      { url: 'https://ml-c.example.com' },
    ];
    sut.setup(config);

    await sut.encodeText('test', { modelName: 'model' });

    expect(fetchMock.mock.calls.map(([url, options]) => [url.href, options.headers])).toEqual([
      [
        'https://ml-a.example.com/predict',
        {
          Authorization: `Basic ${Buffer.from('a:password-a').toString('base64')}`,
        },
      ],
      [
        'https://ml-b.example.com/predict',
        {
          Authorization: `Basic ${Buffer.from('b:password-b').toString('base64')}`,
        },
      ],
      ['https://ml-c.example.com/predict', undefined],
    ]);
  });
});
