import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, SPACE } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Stack({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

/** Prominent banner (offline / outdated information). */
export function Banner({ message, testID }: { message: string; testID?: string }) {
  return (
    <View accessibilityRole="alert" style={styles.banner} testID={testID}>
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACE.md, gap: SPACE.md },
  stack: { gap: SPACE.sm },
  title: { fontSize: FONT.title, fontWeight: '800', color: COLORS.text },
  body: { fontSize: FONT.body, color: COLORS.text, lineHeight: FONT.body * 1.45 },
  muted: { color: COLORS.textMuted },
  banner: { backgroundColor: COLORS.warnBannerBg, borderWidth: 2, borderColor: COLORS.warnBannerText, borderRadius: 12, padding: SPACE.md },
  bannerText: { fontSize: FONT.body, fontWeight: '700', color: COLORS.warnBannerText },
});
