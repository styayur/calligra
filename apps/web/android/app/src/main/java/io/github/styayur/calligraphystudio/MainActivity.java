package io.github.styayur.calligraphystudio;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(OfficialUpdates.class);
        super.onCreate(state);
    }
}
