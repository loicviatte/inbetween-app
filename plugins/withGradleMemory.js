const { withGradleProperties } = require('@expo/config-plugins');

// The production profile runs `lintVitalAnalyzeRelease`, which the development
// profile skips. On the GitHub `--local` runner the default JVM args
// (-Xmx2048m -XX:MaxMetaspaceSize=512m) starve the Android lint worker →
// `java.lang.OutOfMemoryError: Metaspace` on modules like
// react-native-safe-area-context / datetimepicker. Bump heap + metaspace so
// the release lint pass completes. ubuntu-latest has ample RAM for this.
module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    const set = (key, value) => {
      const existing = config.modResults.find(
        (p) => p.type === 'property' && p.key === key
      );
      if (existing) existing.value = value;
      else config.modResults.push({ type: 'property', key, value });
    };
    set(
      'org.gradle.jvmargs',
      '-Xmx4096m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8'
    );
    return config;
  });
};
