import { SafeAreaView, StyleSheet, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

import { AppNavBar } from "./src/components/AppNavBar";
import { ExercisesScreen } from "./src/screens/ExercisesScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { DailyMissionSheet } from "./src/missions/DailyMissionSheet";
import { PlaceholderScreen } from "./src/screens/PlaceholderScreen";
import { StatisticsScreen } from "./src/screens/StatisticsScreen";
import { SPACE_CADET } from "./src/theme/spaceCadet";
import { ensureAudioReady } from "./src/utils/audio";

export default function App() {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryMode, setLibraryMode] = useState("clearance");
  const [missionOpen, setMissionOpen] = useState(false);
  const [launchGameKey, setLaunchGameKey] = useState(null);
  const { width } = useWindowDimensions();
  const pagerRef = useRef(null);
  const pagerPlaced = useRef(false);
  const [pagerHeight, setPagerHeight] = useState(0);
  const pageProgress = useSharedValue(1);
  const onPagerScroll = useAnimatedScrollHandler((event) => { pageProgress.value = event.contentOffset.x / width; });
  // The page nearest to the screen (0 statistics, 1 home, 2 profile), for content that should only animate when seen.
  const [page, setPage] = useState(1);
  useAnimatedReaction(() => Math.round(pageProgress.value), (now, before) => { if (now !== before) runOnJS(setPage)(now); });
  const [fontsLoaded] = useFonts({
    "Gontserrat-Regular": require("./src/assets/fonts/Gontserrat-Regular.ttf"),
    "Gontserrat-Light": require("./src/assets/fonts/Gontserrat-Light.ttf"),
    "Gontserrat-SemiBold": require("./src/assets/fonts/Gontserrat-SemiBold.ttf"),
    "Gontserrat-Bold": require("./src/assets/fonts/Gontserrat-Bold.ttf"),
    "Garet-Book": require("./src/assets/fonts/Garet-Book.ttf"),
    "Nunito-Light": require("./src/assets/fonts/Nunito-Light.ttf"),
    "Nunito-ExtraLight": require("./src/assets/fonts/Nunito-ExtraLight.ttf"),
    "NunitoSans-ExtraLight": require("./src/assets/fonts/NunitoSans-ExtraLight.ttf"),
  });

  useEffect(() => { ensureAudioReady(); }, []);

  function placePager(event) {
    setPagerHeight(event.nativeEvent.layout.height);
    if (pagerPlaced.current) return;
    pagerPlaced.current = true;
    pagerRef.current?.scrollTo({ x: width, animated: false });
  }
  function selectPage(index) { pagerRef.current?.scrollTo({ x: index * width, animated: true }); }

  function openClearance() { setLaunchGameKey(null); setLibraryMode("clearance"); setLibraryOpen(true); }
  function openTraining() { setLaunchGameKey(null); setLibraryMode("daily"); setLibraryOpen(true); }
  function closeLibrary() { setLaunchGameKey(null); setLibraryOpen(false); }

  if (!fontsLoaded) return <GestureHandlerRootView style={styles.app}><StatusBar style="light" /></GestureHandlerRootView>;
  return (
    <GestureHandlerRootView style={styles.app}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.topSafeArea}>
        <View style={styles.screen}>
          <Animated.ScrollView ref={pagerRef} horizontal pagingEnabled bounces={false} showsHorizontalScrollIndicator={false} scrollEventThrottle={16} contentOffset={{ x: width, y: 0 }} onLayout={placePager} onScroll={onPagerScroll}>
            <View style={{ width, height: pagerHeight }}><StatisticsScreen active={page === 0 && !libraryOpen && !missionOpen} /></View>
            <View style={{ width, height: pagerHeight }}><HomeScreen onOpenTraining={openTraining} onOpenClearance={openClearance} onOpenMissions={() => setMissionOpen(true)} /></View>
            <View style={{ width, height: pagerHeight }}><PlaceholderScreen title="Profile page" /></View>
          </Animated.ScrollView>
          {libraryOpen ? <ExercisesScreen key={libraryMode} mode={libraryMode} initialGameKey={launchGameKey} onClose={closeLibrary} /> : null}
          {missionOpen ? <DailyMissionSheet onClose={() => setMissionOpen(false)} /> : null}
        </View>
      </SafeAreaView>
      {!libraryOpen && !missionOpen ? <AppNavBar progress={pageProgress} onSelect={selectPage} /> : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: SPACE_CADET.black }, topSafeArea: { flex: 1, backgroundColor: SPACE_CADET.black }, screen: { flex: 1 },
});
