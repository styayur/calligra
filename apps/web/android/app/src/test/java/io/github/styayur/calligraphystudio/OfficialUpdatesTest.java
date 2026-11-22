package io.github.styayur.calligraphystudio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URL;
import java.security.MessageDigest;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfficialUpdatesTest {
    @Test
    public void stableVersionOrderingUsesNumericSegments() {
        assertTrue(OfficialUpdates.compareVersions("0.10.0", "0.9.9") > 0);
        assertTrue(OfficialUpdates.compareVersions("1.0.0", "0.99.99") > 0);
        assertEquals(0, OfficialUpdates.compareVersions("0.9.0", "0.9.0"));
        assertTrue(OfficialUpdates.compareVersions("0.8.1", "0.9.0") < 0);
        assertThrows(IllegalArgumentException.class, () -> OfficialUpdates.compareVersions("0.10.0-rc.1", "0.9.0"));
        assertThrows(IllegalArgumentException.class, () -> OfficialUpdates.compareVersions("0.090.0", "0.9.0"));
    }
    @Test
    public void onlyOfficialHttpsRedirectHostsAreAllowed() throws Exception {
        assertTrue(OfficialUpdates.trustedHost(new URL("https://api.github.com"), true));
        assertTrue(OfficialUpdates.trustedHost(new URL("https://release-assets.githubusercontent.com"), false));
        assertFalse(OfficialUpdates.trustedHost(new URL("https://release-assets.githubusercontent.com.example.org"), false));
        assertFalse(OfficialUpdates.trustedHost(new URL("http://github.com"), false));
        assertFalse(OfficialUpdates.trustedHost(new URL("https://user@github.com"), false));
        assertFalse(OfficialUpdates.trustedHost(new URL("https://github.com:444"), false));
        assertFalse(OfficialUpdates.trustedHost(new URL("https://github.com"), true));
    }
    @Test
    public void downloadsAreBoundedAndHashed() throws Exception {
        byte[] original = {'a', 'b', 'c'};
        ByteArrayOutputStream target = new ByteArrayOutputStream();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        assertEquals(3, OfficialUpdates.boundedCopy(new ByteArrayInputStream(original), target, 3, digest));
        assertArrayEquals(original, target.toByteArray());
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", OfficialUpdates.hex(digest.digest()));
        assertThrows(IOException.class, () ->
            OfficialUpdates.boundedCopy(new ByteArrayInputStream(original), target, 2, null));
    }
}
