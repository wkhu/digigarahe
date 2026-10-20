import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

const API_BASE = 'http://192.168.1.31:3000/api';
const EXTRACTION_TIMEOUT_MS = 180_000;

interface Product {
  id: string;
  title: string;
  category: string;
  condition?: string;
  estimatedPricePHP?: number;
  description?: string;
  images?: string[];
  facebookCopy?: string;
  carousellCopy?: string;
  status?: string;
}

interface ImageAsset {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
}

type FormData = {
  title: string;
  category: string;
  condition: string;
  price: string;
  description: string;
  facebookCopy: string;
  carousellCopy: string;
};

const emptyForm: FormData = {
  title: '',
  category: '',
  condition: 'Needs confirmation',
  price: '',
  description: '',
  facebookCopy: '',
  carousellCopy: '',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formFromProduct(item: Product): FormData {
  return {
    title: item.title || '',
    category: item.category || '',
    condition: item.condition || 'Needs confirmation',
    price:
      typeof item.estimatedPricePHP === 'number' &&
      item.estimatedPricePHP > 0
        ? String(item.estimatedPricePHP)
        : '',
    description: item.description || '',
    facebookCopy: item.facebookCopy || '',
    carousellCopy: item.carousellCopy || '',
  };
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}). Check the Mac terminal.`
    );
  }

  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `Request failed (HTTP ${response.status}).`;

    throw new Error(error);
  }

  return data;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'create' | 'manage'>(
    'create'
  );
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listingLoading, setListingLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormData>({ ...emptyForm });
  const [existingListings, setExistingListings] = useState<Product[]>(
    []
  );
  const [editingItem, setEditingItem] = useState<Product | null>(null);

  const extractionController = useRef<AbortController | null>(null);
  const cancelReason = useRef<'user' | 'timeout' | null>(null);
  const mounted = useRef(true);
  const busy = loading || saving;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      extractionController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!loading) return;

    const startedAt = Date.now();
    setElapsed(0);

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [loading]);

  const fetchListings = async () => {
    setListingLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(`${API_BASE}/products`, {
        signal: controller.signal,
      });
      const data = await readResponse(response);

      if (!Array.isArray(data)) {
        throw new Error('The server did not return a list of products.');
      }

      if (mounted.current) {
        setExistingListings(data as Product[]);
      }
    } catch (error: unknown) {
      if (mounted.current) {
        Alert.alert('Could not load listings', messageOf(error));
      }
    } finally {
      clearTimeout(timer);
      if (mounted.current) setListingLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'manage') {
      void fetchListings();
    }
  }, [activeTab]);

  const updateForm = (key: keyof FormData, value: string) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      // Core listing edits invalidate the original generated copies.
      ...(key !== 'facebookCopy' && key !== 'carousellCopy'
        ? { facebookCopy: '', carousellCopy: '' }
        : {}),
    }));
  };

  const handleReset = () => {
    setImages([]);
    setProduct(null);
    setEditingItem(null);
    setForm({ ...emptyForm });
  };

  const pickImages = async () => {
    if (busy) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission required',
          'Allow photo library access to select item photos.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 3,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.length) return;

      if (result.assets.length > 3) {
        Alert.alert('Too many photos', 'Select up to 3 photos.');
        return;
      }

      setImages(result.assets);
      setProduct(null);
      setForm({ ...emptyForm });
    } catch (error: unknown) {
      Alert.alert('Could not select photos', messageOf(error));
    }
  };

  const handleExtractWithAI = async () => {
    if (extractionController.current || busy) return;

    if (!images.length) {
      Alert.alert('No image', 'Select at least one photo.');
      return;
    }

    if (images.some((image) => !image.base64)) {
      Alert.alert(
        'Photo data missing',
        'Select the photos again and retry.'
      );
      return;
    }

    const controller = new AbortController();
    extractionController.current = controller;
    cancelReason.current = null;

    setLoading(true);
    setElapsed(0);

    const timer = setTimeout(() => {
      cancelReason.current = 'timeout';
      controller.abort();
    }, EXTRACTION_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          images: images.map((image) => ({
            base64: image.base64,
            mimeType: image.mimeType || 'image/jpeg',
          })),
        }),
        signal: controller.signal,
      });

      // Keep the timeout active until the response body is read.
      const data = await readResponse(response);

      if (
        !data ||
        typeof data !== 'object' ||
        !('id' in data) ||
        !('title' in data) ||
        typeof data.id !== 'string' ||
        typeof data.title !== 'string'
      ) {
        throw new Error('The server returned invalid listing details.');
      }

      if (controller.signal.aborted || !mounted.current) return;

      const extracted = data as Product;
      setProduct(extracted);
      setForm(formFromProduct(extracted));
    } catch (error: unknown) {
      if (!mounted.current) return;

      if (cancelReason.current === 'user') {
        // User explicitly canceled; keep the selected photos.
        return;
      }

      if (cancelReason.current === 'timeout') {
        Alert.alert(
          'Extraction timed out',
          'No result arrived within 3 minutes. The server may still be processing. Check the Mac terminal before retrying.'
        );
      } else {
        Alert.alert(
          'Extraction failed',
          `${messageOf(error)}\n\nKeep the app open and check that the phone and Mac can reach each other at ${API_BASE}.`
        );
      }
    } finally {
      clearTimeout(timer);
      extractionController.current = null;

      if (mounted.current) setLoading(false);
    }
  };

  const cancelExtraction = () => {
    cancelReason.current = 'user';
    extractionController.current?.abort();
  };

  const parsedPrice = () =>
    Number(form.price.replace(/,/g, '').trim());

  const fallbackCopy = (platform: 'facebook' | 'carousell') => {
    const amount = parsedPrice();
    const priceText =
      Number.isFinite(amount) && amount > 0
        ? `₱${amount.toLocaleString('en-PH')}`
        : 'Price to be confirmed';

    return [
      platform === 'facebook' ? `🏷️ ${form.title}` : form.title,
      `Price: ${priceText}`,
      `Condition: ${form.condition || 'Needs confirmation'}`,
      '',
      form.description,
      '',
      'Pickup location and meetup arrangements to be confirmed.',
    ].join('\n');
  };

  const handleCopy = async (
    platform: 'facebook' | 'carousell'
  ) => {
    try {
      const generated =
        platform === 'facebook'
          ? form.facebookCopy
          : form.carousellCopy;

      await Clipboard.setStringAsync(
        generated || fallbackCopy(platform)
      );

      Alert.alert(
        'Copied',
        `${
          platform === 'facebook' ? 'Facebook Marketplace' : 'Carousell'
        } text copied.`
      );
    } catch (error: unknown) {
      Alert.alert('Could not copy text', messageOf(error));
    }
  };

  const handleSaveListing = async () => {
    if (saving) return;

    const source = editingItem || product;

    if (!source) return;

    if (!form.title.trim() || !form.category.trim()) {
      Alert.alert('Missing details', 'Enter a title and category.');
      return;
    }

    const amount = parsedPrice();

    if (
      !form.price.trim() ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      Alert.alert(
        'Price required',
        'Enter a valid asking price greater than zero before saving.'
      );
      return;
    }

    setSaving(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${API_BASE}/products`, {
        method: editingItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...source,
          title: form.title.trim(),
          category: form.category.trim(),
          condition: form.condition.trim() || 'Needs confirmation',
          estimatedPricePHP: amount,
          description: form.description.trim(),
          images: source.images || [],
          facebookCopy:
            form.facebookCopy || fallbackCopy('facebook'),
          carousellCopy:
            form.carousellCopy || fallbackCopy('carousell'),
          status: source.status || 'AVAILABLE',
        }),
      });

      await readResponse(response);

      if (!mounted.current) return;

      Alert.alert(
        'Saved',
        editingItem
          ? 'Listing updated successfully.'
          : 'Listing saved successfully.'
      );

      handleReset();

      if (activeTab === 'manage') {
        void fetchListings();
      } else {
        setActiveTab('manage');
      }
    } catch (error: unknown) {
      if (mounted.current) {
        Alert.alert(
          'Could not confirm save',
          `${messageOf(error)}\n\nIf the request was interrupted, refresh My Listings before retrying.`
        );
      }
    } finally {
      clearTimeout(timer);
      if (mounted.current) setSaving(false);
    }
  };

  const switchTab = (tab: 'create' | 'manage') => {
    if (busy) return;
    handleReset();
    setActiveTab(tab);
  };

  const showForm =
    activeTab === 'create' ? Boolean(product) : Boolean(editingItem);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.headerTitle}>
        DigiGarahe Seller 🧸📺
      </Text>
      <Text style={styles.subtitle}>
        AI-Assisted Garage Sale Listing
      </Text>

      <View style={styles.tabs}>
        {(['create', 'manage'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            disabled={busy}
            style={[
              styles.tab,
              activeTab === tab && styles.activeTab,
            ]}
            onPress={() => switchTab(tab)}
          >
            <Text style={styles.tabText}>
              {tab === 'create' ? '✨ New Listing' : '📦 My Listings'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'create' && (
        <>
          <TouchableOpacity
            style={styles.imageBox}
            onPress={pickImages}
            disabled={busy}
          >
            {images.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imageRow}
              >
                {images.map((image, index) => (
                  <Image
                    key={`${image.uri}-${index}`}
                    source={{ uri: image.uri }}
                    style={styles.thumbnail}
                  />
                ))}
              </ScrollView>
            ) : (
              <View>
                <Text style={styles.placeholder}>
                  + Tap to Add Photos
                </Text>
                <Text style={styles.hint}>
                  Select up to 3 JPEG, PNG, or WebP photos
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {images.length > 0 && !product && (
            <TouchableOpacity
              style={[styles.button, loading && styles.disabled]}
              disabled={loading}
              onPress={handleExtractWithAI}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  ✨ Extract Details
                </Text>
              )}
            </TouchableOpacity>
          )}

          {loading && (
            <View style={styles.loadingCard}>
              <Text style={styles.loadingTitle}>
                Analyzing photos… {elapsed}s
              </Text>
              <Text style={styles.hint}>
                Keep this app open. The request can take up to 3 minutes.
              </Text>
              <TouchableOpacity
                style={styles.textButton}
                onPress={cancelExtraction}
              >
                <Text style={styles.link}>Cancel request</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {showForm && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {editingItem
              ? '✏️ Edit Listing'
              : '✏️ Review & Edit Listing'}
          </Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={form.title}
            onChangeText={(value) => updateForm('title', value)}
            editable={!saving}
          />

          <Text style={styles.label}>Category</Text>
          <TextInput
            style={styles.input}
            value={form.category}
            onChangeText={(value) => updateForm('category', value)}
            editable={!saving}
          />

          <Text style={styles.label}>Condition</Text>
          <TextInput
            style={styles.input}
            value={form.condition}
            onChangeText={(value) => updateForm('condition', value)}
            editable={!saving}
          />

          <Text style={styles.label}>Asking Price (PHP)</Text>
          <TextInput
            style={styles.input}
            value={form.price}
            placeholder="Enter price"
            keyboardType="decimal-pad"
            onChangeText={(value) => updateForm('price', value)}
            editable={!saving}
          />
          <Text style={styles.hint}>
            {form.price
              ? 'Review the AI suggestion before publishing.'
              : 'The AI did not provide an estimate. Enter your asking price.'}
          </Text>

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={form.description}
            multiline
            onChangeText={(value) =>
              updateForm('description', value)
            }
            editable={!saving}
          />

          <View style={styles.crossPost}>
            <Text style={styles.cardTitle}>📤 Cross-Post Utility</Text>
            <Text style={styles.hint}>
              Copy text to paste into an external marketplace.
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.facebook]}
              onPress={() => handleCopy('facebook')}
            >
              <Text style={styles.buttonText}>
                📋 Copy for Facebook Marketplace
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.carousell]}
              onPress={() => handleCopy('carousell')}
            >
              <Text style={styles.buttonText}>
                📋 Copy for Carousell
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              styles.save,
              saving && styles.disabled,
            ]}
            disabled={saving}
            onPress={handleSaveListing}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {editingItem ? '💾 Save Changes' : '🚀 Publish Listing'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            disabled={saving}
            onPress={handleReset}
          >
            <Text style={styles.link}>
              {editingItem ? 'Back to List' : 'Cancel'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'manage' && !editingItem && (
        <View>
          <TouchableOpacity
            style={styles.button}
            disabled={listingLoading}
            onPress={fetchListings}
          >
            {listingLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Refresh Listings</Text>
            )}
          </TouchableOpacity>

          {!listingLoading && existingListings.length === 0 && (
            <Text style={styles.empty}>No listings found.</Text>
          )}

          {existingListings.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.listCard}
              onPress={() => {
                setEditingItem(item);
                setForm(formFromProduct(item));
              }}
            >
              <View style={styles.listDetails}>
                <Text style={styles.listTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.hint}>
                  {item.category}
                  {' • '}
                  {(item.estimatedPricePHP || 0) > 0
                    ? `₱${item.estimatedPricePHP!.toLocaleString('en-PH')}`
                    : 'Price to be confirmed'}
                </Text>
              </View>
              <Text style={styles.link}>Edit ✍️</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 60,
    paddingBottom: 50,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#fff',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  imageBox: {
    height: 200,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  imageRow: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  thumbnail: {
    width: 140,
    height: 165,
    borderRadius: 12,
    marginRight: 12,
    resizeMode: 'contain',
  },
  placeholder: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    marginTop: 6,
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  loadingCard: {
    padding: 16,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    marginBottom: 16,
  },
  loadingTitle: {
    color: '#1e40af',
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 20,
  },
  cardTitle: {
    color: '#1e293b',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 11,
    fontSize: 15,
    color: '#334155',
    backgroundColor: '#f8fafc',
  },
  textArea: {
    minHeight: 150,
    textAlignVertical: 'top',
  },
  crossPost: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  facebook: {
    backgroundColor: '#1877f2',
  },
  carousell: {
    backgroundColor: '#d0021b',
  },
  save: {
    backgroundColor: '#16a34a',
    marginTop: 20,
  },
  textButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  link: {
    color: '#2563eb',
    fontWeight: '600',
    fontSize: 14,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  listDetails: {
    flex: 1,
    marginRight: 12,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  empty: {
    textAlign: 'center',
    color: '#64748b',
    marginTop: 25,
  },
});